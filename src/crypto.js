"use strict";

import crypto from 'crypto';


/**
 * Generates PKP (podpisovy kod poplatnika)
 * @see http://www.etrzby.cz/assets/cs/prilohy/EET_popis_rozhrani_v3.1.1.pdf (section 4.1)
 */
export function generatePKP(privateKey, { dic_popl, id_provoz, id_pokl, porad_cis, dat_trzby, celk_trzba }) {

	const options = [dic_popl, id_provoz, id_pokl, porad_cis, dat_trzby, celk_trzba];
	const strToHash = options.join('|');

	const sign = crypto.createSign('RSA-SHA256');
	sign.write(strToHash);
	sign.end();

	return sign.sign(privateKey, 'base64');

}

/**
 * Generates BKP (bezpecnostni kod poplatnika)
 * @see http://www.etrzby.cz/assets/cs/prilohy/EET_popis_rozhrani_v3.1.1.pdf (section 4.2)
 */
export function generateBKP(pkp) {

	const buffer = Buffer.from(pkp, 'base64');

	const hash = crypto.createHash('sha1');
	hash.update(buffer);
	const sha1str = hash.digest('hex').toUpperCase();

	return sha1str.match(/(.{1,8})/g).join('-');

}
