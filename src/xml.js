"use strict";

import parser from 'fast-xml-parser';
import { isDefined } from './utils';
import { hashSha256Base64, removePkcsHeader, signSha256Base64 } from './crypto';
import { ResponseParsingError, ResponseServerError } from './errors';


// TODO: warn about XSS and why is not a problem for us

/**
 * Generates data for XML element Data
 * TODO: describe why the attributes must be sorted and why the self-closing tag cannot be used
 * @param name {string}
 * @param attributes {object}
 * @returns {string} canonical TODO: expand the desc of the return value
 */
export const serializeXMLElement = (name, attributes) =>
	`<${name} ${
		Object.entries(attributes)
			.map(([key, value]) => `${key}="${value}"`)
			.sort() // TODO: what about the same attributes, is it okay that in such case it is sorted by the value?
			.join(' ')}></${name}>`
;

/**
 * Generates data for XML element KontrolniKody
 * @param pkp {string} PKP
 * @param bkp {string} BKP
 * @returns {string} canonical TODO: expand the desc of the return value
 */
export const serializeKontrolniKody = ({ pkp, bkp }) =>
	'<KontrolniKody>' +
	`<pkp cipher="RSA2048" digest="SHA256" encoding="base64">${pkp}</pkp>` +
	`<bkp digest="SHA1" encoding="base16">${bkp}</bkp>` +
	'</KontrolniKody>';
;

/**
 * Generates content for SOAP body from header and data objects
 * @param header {object}
 * @param data {object}
 * @param pkp {string}
 * @param bkp {string}
 * @returns {string} canonical TODO: expand the desc of the return value
 */
export const serializeSoapBody = ({ header, data, pkp, bkp }) =>
	'<soap:Body xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" id="Body">' +
	'<Trzba xmlns="http://fs.mfcr.cz/eet/schema/v3">' +
	serializeXMLElement('Hlavicka', header) +
	serializeXMLElement('Data', data) +
	serializeKontrolniKody({ pkp, bkp }) +
	'</Trzba>' +
	'</soap:Body>'
;

/**
 * Generate body signature for XML element SignedInfo
 * @param digest {string} a SHA256 hash of body encoded as base64 string
 * @returns {string} canonical
 */
export const serializeSignedInfo = digest =>
	'<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">' +
	'<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod>' +
	'<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod>' +
	'<Reference URI="#Body">' +
	'<Transforms>' +
	'<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>' +
	'<Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></Transform>' +
	'</Transforms>' +
	'<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod>' +
	`<DigestValue>${digest}</DigestValue>` +
	'</Reference>' +
	'</SignedInfo>'
;

/**
 * Generates full SOAP envelope with WSSecurity signature
 * @returns {string}
 */
export const serializeSoapEnvelope = ({ header, data, pkp, bkp, privateKey, certificate }) => {

	const body = serializeSoapBody({ header, data, bkp, pkp });
	const signedInfo = serializeSignedInfo(hashSha256Base64(body));
	const signature = signSha256Base64(privateKey, signedInfo);
	const publicKey = removePkcsHeader(certificate);

	return (
		`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
			<soap:Header>
				<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" soap:mustUnderstand="1">
					<wsse:BinarySecurityToken wsu:Id="cert" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3">${publicKey}</wsse:BinarySecurityToken>
					<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
						${signedInfo}
						<SignatureValue>${signature}</SignatureValue>
						<KeyInfo>
							<wsse:SecurityTokenReference>
								<wsse:Reference URI="#cert" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" />
							</wsse:SecurityTokenReference>
						</KeyInfo>
					</Signature>
				</wsse:Security>
			</soap:Header>
			${body}
		</soap:Envelope>`
	);

};

/**
 * Parse XML response into DOM
 * TODO: remove Promise
 * @param xml {string}
 * @returns {Promise}
 * @throws {ResponseParsingError}
 * @throws {ResponseServerError}
 */
export const parseResponseXML = (xml) => {

	return new Promise((resolve, reject) => {

		const parsingError = parser.validate(xml);

		if (parsingError === true) {

			const options = {
				attributeNamePrefix: "_",
				ignoreAttributes: false,
				ignoreNameSpace: true,
			};

			const parsed = parser.parse(xml, options);

			return resolve(parsed);

		}
		else {

			return reject(new ResponseParsingError('Error parsing XML', parsingError));

		}

	});

};

/**
 * Transform XML DOM into data object
 * TODO: remove Promise
 * @param parsed {object}
 * @returns {object}
 * @throws {ResponseParsingError}
 * @throws {ResponseServerError}
 */
export const extractResponse = parsed => {

	return new Promise((resolve, reject) => {

		try {

			const header = parsed['Envelope']['Body']['Odpoved']['Hlavicka'];
			const body = parsed['Envelope']['Body']['Odpoved']['Potvrzeni'];

			const data = {
				uuid: header['_uuid_zpravy'],
				bkp: header['_bkp'],
				date: new Date(header['_dat_prij']),
				test: body['_test'] === 'true',
				fik: body['_fik'],
			};

			// Warning(s) can be part of message
			const warnings = parsed['Envelope']['Body']['Odpoved']['Varovani'];
			if (isDefined(warnings)) {

				if (Array.isArray(warnings)) {

					// Multiple warnings in an array
					data.warnings = warnings
						.map((warning) => {
							return {
								message: warning['#text'],
								code: warning['_kod_varov'],
							}
						});
				}
				else {

					// Make array from single warning
					data.warnings = [{
						message: warnings['#text'],
						code: warnings['_kod_varov'],
					}];
				}
			}

			return resolve(data);

		} catch (e) {

			// Try to parse error message from XML
			return reject(new ResponseServerError(
				parsed['Envelope']['Body']['Odpoved']['Chyba']['#text'],
				parsed['Envelope']['Body']['Odpoved']['Chyba']['_kod'],
			));

		}

	});

};

// TODO: remove Promise and finish (check bkp and option.playground too)
export const validateSOAPSignature = xml => {
	return new Promise((resolve, reject) => {

		// TODO: validate digital signature here
		return resolve(xml);

	});
};