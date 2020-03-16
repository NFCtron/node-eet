"use strict";

import crypto from 'crypto';


/**
 * Generates PKP (podpisovy kod poplatnika)
 * @see http://www.etrzby.cz/assets/cs/prilohy/EET_popis_rozhrani_v3.1.1.pdf (section 4.1)
 */
export const generatePKP = (privateKey, { dic_popl, id_provoz, id_pokl, porad_cis, dat_trzby, celk_trzba }) => {
	const options = [dic_popl, id_provoz, id_pokl, porad_cis, dat_trzby, celk_trzba];
	const strToHash = options.join('|');
	return signSha256Base64(privateKey, strToHash);
};

/**
 * Generates BKP (bezpecnostni kod poplatnika)
 * SHA256, hex format, case insensitive, 5 block of 8 chars joined with '-'
 * Always returned lowercase
 * @see http://www.etrzby.cz/assets/cs/prilohy/EET_popis_rozhrani_v3.1.1.pdf (section 4.2)
 */
export const generateBKP = (pkp) => {
	const buffer = Buffer.from(pkp, 'base64');
	const sha1str = hashSha1Hex(buffer);
	return [sha1str.slice(0, 8), sha1str.slice(8, 16), sha1str.slice(16, 24), sha1str.slice(24, 32), sha1str.slice(32, 40)]
		.join('-')
		.toLowerCase();
};


export const signSha256Base64 = (privateKey, data) => {
	const sign = crypto.createSign('rsa-sha256');
	sign.update(data);
	return sign.sign(privateKey, 'base64');
};


export const hashSha1Hex = data => {
	const hash = crypto.createHash('sha1');
	hash.update(data);
	return hash.digest('hex');
};


export const hashSha256Base64 = data => {
	const hash = crypto.createHash('sha256');
	hash.update(data);
	return hash.digest('base64');
};

/**
 * Parse PKCS#1 RSA private key and extracts the private key
 * @returns {string}
 */
export const getPublicKey = certificate => {
	return certificate
		.toString()
		.replace(/\r?\n/g, '')
		.replace(/-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=]+)-----END CERTIFICATE-----/, '$1');
};
