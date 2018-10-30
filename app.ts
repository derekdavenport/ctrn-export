import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as querystring from 'querystring';
import { URL } from 'url';
import { parse, HTMLElement } from 'node-html-parser';

const [hostname, OrgID, UserId, pass, noImageFilename, maxFileSizeMBvalue] = process.argv.slice(2);
const baseURL = new URL('https://' + hostname + '/directory/');
const maxFileSizeMB = parseInt(maxFileSizeMBvalue) || 15;
const maxFileSize = maxFileSizeMB * 1024 * 1024;
const maxRetries = 5;

main();

async function main() {
	// let cookies: string[];
	// try {
	// 	cookies = await login();
	// }
	// catch (error) {
	// 	process.exit(1);
	// }
	const people = [];
	const vcardPromises = [];
	try {
		const directory = await loadDirectory();
		const root = parse(directory);
		for (const userDiv of root.querySelectorAll('.group_user_div-tall') as HTMLElement[]) {
			const vcardLink = userDiv.querySelector('.vcard_image a') as HTMLElement;
			const img = userDiv.querySelector('.newphotos_member') as HTMLElement;
			const vcardURL = new URL(vcardLink.attributes['href'], baseURL);
			const imageURL = new URL(img.attributes['src'], baseURL);
			//const personId = vcardURL.searchParams.get('mid');
			vcardPromises.push(makeVcard(vcardURL, imageURL));
		}
		const vcards = await Promise.all(vcardPromises);
		const fileNames = await writeVcards(vcards);
		console.log('wrote ' + fileNames.join(', '));
	}
	catch (error) {
		console.log(error);
		process.exit(1);
	}
}

async function writeVcards(vcards: string[]) {
	return new Promise<string[]>(resolve => {
		let i = 0;
		let fileNames: string[] = [];
		let stream: fs.WriteStream;
		let writtenBytes = 0;
		(function write() {
			for (let ok = true; i < vcards.length && ok; i++) {
				const vcardBuffer = Buffer.from(vcards[i]);
				if (!stream || writtenBytes + vcardBuffer.byteLength > maxFileSize) {
					if (stream) {
						stream.end();
					}
					const fileName = `ctrn-vcards-${fileNames.length}.vcf`;
					fileNames.push(fileName);
					stream = fs.createWriteStream(fileName, { flags: 'w' });
					writtenBytes = 0;
				}
				// Buffer.byteLength(str, 'utf8')
				ok = stream.write(vcardBuffer);
				writtenBytes += vcardBuffer.byteLength;
			}
			if (i < vcards.length) {
				stream.once('drain', write);
			}
			else {
				stream.end();
				resolve(fileNames);
			}
		})();
	});
}

async function makeVcard(vcardURL: URL, imageURL: URL) {
	const hasImage = path.basename(imageURL.pathname) !== noImageFilename;
	const vcardPromise = get(vcardURL);
	const imagePromise = hasImage ? get(imageURL) : null;
	let vcard, image;
	try {
		image = await imagePromise;
	}
	catch (error) {
		console.log('unable to download image for ' + vcardURL.searchParams.get('mid'));
	}
	try {
		vcard = await vcardPromise;
	}
	catch (error) {
		console.log('unable to download contact for ' + vcardURL.searchParams.get('mid'));
		return '';
	}

	return vcard.toString()
		// replace work line with image or remove
		.replace(/^ADR;TYPE=work:.*\s*/m, image ? ('PHOTO;ENCODING=b;TYPE=JPEG:' + image.toString('base64')).replace(/(^.{75}|(?!^).{74}(?=.))/g, '$1\r\n ') + '\r\n' : '')
		// change birthdays to ISO format (birthdays without a year will become 2001)
		.replace(/^BDAY:(.*)/m, (_, dateValue) => {
			try {
				return 'BDAY:' + new Date(dateValue).toISOString().substring(0, 10);
			}
			catch (error) {
				return 'BDAY;VALUE=text:' + dateValue;
			}
		});
}

async function get(url: URL, retries = 0) {
	return new Promise<Buffer>((resolve, reject) => {
		let buffers: Buffer[] = [];
		const request = https.get(url, response => {
			response.on('data', (chunk: Buffer) => buffers.push(chunk));
			response.on('end', () => resolve(Buffer.concat(buffers)));
		});
		request.on('error', async error => {
			let r = request;
			// console.error(`${url} : ${e.message}`);
			if (retries < maxRetries) {
				try {
					resolve(await get(url, retries + 1));
				}
				catch (retryError) {
					reject(retryError);
				}
			}
			reject(error);
		});
		request.end();
	});
}

async function loadDirectory() {
	return new Promise<string>(resolve => {
		const postData = querystring.stringify({
			o: OrgID,
			os: 1,
			srctyp: 'mem',
			di: 'all',
			limit: 300,
			q: '%%%',
			sw: null,
			pu: UserId,
		})
		let buffers: Buffer[] = [];
		const request = https.request({
			hostname,
			path: '/includes/async.php?q=%%%&todo=org_dir',
			method: 'POST',
			headers: {
				//Cookie: querystring.stringify(cookies, '; '),
				'Content-Type': 'application/x-www-form-urlencoded',
				'Content-Length': Buffer.byteLength(postData),
			},
		}, response => {
			response.on('data', (chunk: Buffer) => buffers.push(chunk));
			response.on('end', () => resolve(Buffer.concat(buffers).toString()));
		});
		request.end(postData);
	});
}

async function login() {
	return new Promise<string[]>((resolve, reject) => {
		const postData = querystring.stringify({
			user: 'orguserctrn',
			pass,
			keepLoggedInPk: 1,
			user2: null,
			pass2: null,
		});

		const options = {
			hostname,
			path: '/directory/index.php',
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Content-Length': Buffer.byteLength(postData)
			}
		};

		const request = https.request(options, response => {
			if (response.statusCode === 302) {
				const setCookies = response.headers["set-cookie"];
				resolve(setCookies.map(setCookie => setCookie.split(';')[0]));
			}
			else {
				reject(response.statusCode);
			}
		});
		request.on('error', e => {
			console.error(`problem with request: ${e.message}`);
			reject(e);
		});
		request.end(postData);
	});
}