import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as querystring from 'querystring';
import { URL } from 'url';
import { parse, HTMLElement } from 'node-html-parser';

const [hostname, OrgID, UserId, pass] = process.argv.slice(2);
const baseURL = new URL('https://' + hostname + '/directory/');
const noImageFilename = 'tn_b0539ee4ad44817af56d21786dd6b520_1362965845.jpg';

const splitSize = 20 * 1024 * 1024; // bytes

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
		let i = 0;
		for (const userDiv of root.querySelectorAll('.group_user_div-tall') as HTMLElement[]) {
			if (i++ < 4) continue;
			const vcardLink = userDiv.querySelector('.vcard_image a') as HTMLElement;
			const img = userDiv.querySelector('.newphotos_member') as HTMLElement;
			const vcardURL = new URL(vcardLink.attributes['href'], baseURL);
			const imageURL = new URL(img.attributes['src'], baseURL);
			//const personId = vcardURL.searchParams.get('mid');
			vcardPromises.push(makeVcard(vcardURL, imageURL));

			// cut short while debugging
			if (vcardPromises.length == 1)
				break;
		}
		// TODO: split by splitSize
		const vcards = await Promise.all(vcardPromises);
		fs.writeFile('ctrn-vcards.vcf', vcards.join(''), error => {
			console.log(error);
			process.exit(1);
		});
	}
	catch (error) {
		console.log(error);
		process.exit(1);
	}
}

async function makeVcard(vcardURL: URL, imageURL: URL) {
	const hasImage = path.basename(imageURL.pathname) !== noImageFilename;
	const [vcard, image] = await Promise.all([
		get(vcardURL),
		hasImage ? get(imageURL) : null
	]);
	return vcard.toString()
		// replace work line with image or remove
		.replace(/^ADR;TYPE=work:.*\s*/m, image ? ('PHOTO;ENCODING=b;TYPE=JPEG:' + image.toString('base64')).replace(/(^.{75}|(?!^).{74}(?=.))/g, '$1\r\n ') + '\r\n' : '')
		// change birthdays to ISO format (birthdays without a year will become 2001)
		.replace(/^BDAY:(.*)/m, (_, dateValue) => 'BDAY:' + new Date(dateValue).toISOString().substring(0,10));
}

async function get(url: URL) {
	return new Promise<Buffer>(resolve => {
		let buffers: Buffer[] = [];
		const request = https.get(url, response => {
			response.on('data', (chunk: Buffer) => buffers.push(chunk));
			response.on('end', () => resolve(Buffer.concat(buffers)));
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