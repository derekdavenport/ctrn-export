import * as https from 'https';
import * as fs from 'fs';
import * as querystring from 'querystring';
import { URL } from 'url';
import { parse, HTMLElement } from 'node-html-parser';

const [hostname, OrgID, UserId, pass] = process.argv.slice(2);
const baseURL = new URL('https://' + hostname + '/directory/');

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
		for (const userDiv of root.querySelectorAll('.group_user_div-tall') as HTMLElement[]) {
			const vcardLink = userDiv.querySelector('.vcard_image a') as HTMLElement;
			const vcardURL = new URL(vcardLink.attributes['href'], baseURL);
			//const personId = vcardURL.searchParams.get('mid');
			const img = userDiv.querySelector('.newphotos_member') as HTMLElement;
			const imgURLvalue = img.attributes['src'];
			let imagePromise = null;
			// ignore missing photos (this filename will be different for other directories)
			if (!imgURLvalue.endsWith('tn_b0539ee4ad44817af56d21786dd6b520_1362965845.jpg')) {
				imagePromise = get(new URL(imgURLvalue, baseURL));
			}
			// after both load, put image in card
			vcardPromises.push(Promise.all([get(vcardURL), imagePromise])
				.then(([vcard, image]) => patchVcard(vcard, image)));
			// cut short while debugging
			if (vcardPromises.length == 4)
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

function patchVcard(vcard: Buffer, image: Buffer | null): string {
	const parts = vcard.toString().split('\r\n');
	for (const i of parts.keys()) {
		if (parts[i].startsWith('ADR;TYPE=work:')) {
			if (image) {
				parts[i] = 'PHOTO;ENCODING=BASE64;JPEG:' + image.toString('base64');
			}
			else {
				parts.splice(i, 1);
			}
			break;
		}

	}
	return parts.join('\r\n');
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