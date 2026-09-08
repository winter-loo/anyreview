import { liveSnapshot } from '$lib/server/live/snapshots';
import { execFileSync } from 'node:child_process';
import { realpathSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { _pathFromToken, _pathsFromToken, load } from './[token]/+page.server';
import { GET as getImage } from './[token]/image/+server';
import { GET as getPdf } from './[token]/pdf/+server';
import { GET as getWord } from './[token]/word/+server';
import { GET as getPpt } from './[token]/ppt/+server';
import { GET as getExcel } from './[token]/excel/+server';
import { GET as getHtml } from './[token]/html/+server';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

let feedbackDirectory = '';
const originalFeedbackHome = process.env.ONLINE_REVIEW_FEEDBACK_HOME;
beforeEach(() => { feedbackDirectory = mkdtempSync('/tmp/live-review-test-'); process.env.ONLINE_REVIEW_FEEDBACK_HOME = feedbackDirectory; });
afterEach(() => { if(originalFeedbackHome===undefined)delete process.env.ONLINE_REVIEW_FEEDBACK_HOME;else process.env.ONLINE_REVIEW_FEEDBACK_HOME=originalFeedbackHome;rmSync(feedbackDirectory,{recursive:true,force:true}); });

const cli = fileURLToPath(new URL('../../../bin/review.js', import.meta.url));
const fixture = fileURLToPath(new URL('../../../README.md', import.meta.url));

// 1x1 transparent PNG buffer
const DUMMY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);

const MINIMAL_PDF = Buffer.from(
	'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000108 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n185\n%%EOF\n',
	'utf8'
);

describe('standalone live review URL', () => {
	it('accepts legacy Word documents in the CLI and page', () => {
		const filePath = fileURLToPath(new URL('../../../samples/documents/reviewloop-prd.doc', import.meta.url));
		const secret = 'legacy-doc-test';
		const originalSecret = process.env.ONLINE_REVIEW_URL_SECRET;
		process.env.ONLINE_REVIEW_URL_SECRET = secret;
		try {
			const url = execFileSync(cli, [filePath], { env: { ...process.env }, encoding: 'utf8' }).trim();
			const token = url.split('/').at(-1)!;
			expect(load({ params: { token }, setHeaders: () => {} } as any)).toMatchObject({ kind: 'word', filename: 'reviewloop-prd.doc' });
		} finally {
			if (originalSecret === undefined) delete process.env.ONLINE_REVIEW_URL_SECRET;
			else process.env.ONLINE_REVIEW_URL_SECRET = originalSecret;
		}
	});

	it('accepts legacy PowerPoint presentations in the CLI and page', () => {
		const filePath = fileURLToPath(new URL('../../../samples/documents/reviewloop-quarterly.ppt', import.meta.url));
		const secret = 'legacy-ppt-test';
		const originalSecret = process.env.ONLINE_REVIEW_URL_SECRET;
		process.env.ONLINE_REVIEW_URL_SECRET = secret;
		try {
			const url = execFileSync(cli, [filePath], { env: { ...process.env }, encoding: 'utf8' }).trim();
			const token = url.split('/').at(-1)!;
			expect(load({ params: { token }, setHeaders: () => {} } as any)).toMatchObject({ kind: 'ppt', filename: 'reviewloop-quarterly.ppt' });
		} finally {
			if (originalSecret === undefined) delete process.env.ONLINE_REVIEW_URL_SECRET;
			else process.env.ONLINE_REVIEW_URL_SECRET = originalSecret;
		}
	});

	it('round-trips the original path and rejects a modified token', () => {
		const secret = 'test-secret';
		const url = execFileSync(cli, [fixture], {
			env: { ...process.env, ONLINE_REVIEW_URL_SECRET: secret },
			encoding: 'utf8'
		}).trim();
		const token = url.split('/').at(-1)!;
		expect(_pathFromToken(token, secret)).toBe(realpathSync(fixture));
		expect(() => _pathFromToken(`${token}x`, secret)).toThrow();
	});

	it('supports single image file and loads image review mode', () => {
		const secret = 'test-secret-image-1';
		const imgPath = '/tmp/live-test-img-single.png';
		writeFileSync(imgPath, DUMMY_PNG);
		const originalSecret = process.env.ONLINE_REVIEW_URL_SECRET;
		process.env.ONLINE_REVIEW_URL_SECRET = secret;

		try {
			const url = execFileSync(cli, [imgPath], {
				env: { ...process.env, ONLINE_REVIEW_URL_SECRET: secret },
				encoding: 'utf8'
			}).trim();

			const token = url.split('/').at(-1)!;
			const paths = _pathsFromToken(token, secret);
			expect(paths).toEqual([realpathSync(imgPath)]);

			// Test server load
			const pageData = load({
				params: { token },
				setHeaders: () => {}
			} as any);

			expect(pageData).toMatchObject({
				kind: 'image',
				token
			});
			expect((pageData as any).images).toHaveLength(1);
			expect((pageData as any).images[0].filename).toBe('live-test-img-single.png');
			expect((pageData as any).images[0].src).toBe(`/live/${token}/image?index=0&v=${liveSnapshot(token).version}`);
		} finally {
			process.env.ONLINE_REVIEW_URL_SECRET = originalSecret;
			try { unlinkSync(imgPath); } catch {}
		}
	});

	it('supports multiple image files and serves them via image endpoint', async () => {
		const secret = 'test-secret-multi';
		const img1 = '/tmp/live-test-multi-1.png';
		const img2 = '/tmp/live-test-multi-2.png';
		writeFileSync(img1, DUMMY_PNG);
		writeFileSync(img2, DUMMY_PNG);
		const originalSecret = process.env.ONLINE_REVIEW_URL_SECRET;
		process.env.ONLINE_REVIEW_URL_SECRET = secret;

		try {
			const url = execFileSync(cli, [img1, img2], {
				env: { ...process.env, ONLINE_REVIEW_URL_SECRET: secret },
				encoding: 'utf8'
			}).trim();

			const token = url.split('/').at(-1)!;
			const paths = _pathsFromToken(token, secret);
			expect(paths).toEqual([realpathSync(img1), realpathSync(img2)]);

			// Test server load
			const pageData = load({
				params: { token },
				setHeaders: () => {}
			} as any);

			expect(pageData).toMatchObject({
				kind: 'image',
				token
			});
			const images = (pageData as any).images;
			expect(images).toHaveLength(2);
			expect(images[0].filename).toBe('live-test-multi-1.png');
			expect(images[1].filename).toBe('live-test-multi-2.png');
			expect(images[0].src).toBe(`/live/${token}/image?index=0&v=${liveSnapshot(token).version}`);
			expect(images[1].src).toBe(`/live/${token}/image?index=1&v=${liveSnapshot(token).version}`);

			// Test image server route GET
			const res0 = await getImage({
				params: { token },
				url: new URL(`https://example.com/live/${token}/image?index=0`)
			} as any);
			expect(res0.status).toBe(200);
			expect(res0.headers.get('cache-control')).toBe('no-store');
			expect(res0.headers.get('content-type')).toBe('image/png');
			const buffer0 = Buffer.from(await res0.arrayBuffer());
			expect(buffer0.equals(DUMMY_PNG)).toBe(true);

			const res1 = await getImage({
				params: { token },
				url: new URL(`https://example.com/live/${token}/image?index=1`)
			} as any);
			expect(res1.status).toBe(200);
			expect(res1.headers.get('content-type')).toBe('image/png');

			// Invalid index returns 404
			expect(() =>
				getImage({
					params: { token },
					url: new URL(`https://example.com/live/${token}/image?index=99`)
				} as any)
			).toThrow();
		} finally {
			process.env.ONLINE_REVIEW_URL_SECRET = originalSecret;
			try { unlinkSync(img1); } catch {}
			try { unlinkSync(img2); } catch {}
		}
	});

	it('rejects images exceeding 5 MiB', () => {
		const secret = 'test-secret-oversized';
		const oversizedImg = '/tmp/live-test-oversized.png';
		// Create a file slightly larger than 5 MiB (5 * 1024 * 1024 + 10 bytes)
		const bigBuffer = Buffer.alloc(5 * 1024 * 1024 + 10);
		writeFileSync(oversizedImg, bigBuffer);

		try {
			// CLI should reject
			expect(() =>
				execFileSync(cli, [oversizedImg], {
					env: { ...process.env, ONLINE_REVIEW_URL_SECRET: secret },
					encoding: 'utf8'
				})
			).toThrow(/Image must be no larger than 5 MiB/);
		} finally {
			try { unlinkSync(oversizedImg); } catch {}
		}
	});

	it('generates short URL by default and long token with --long flag', () => {
		const secret = 'test-secret-short';
		const shortUrl = execFileSync(cli, [fixture], {
			env: { ...process.env, ONLINE_REVIEW_URL_SECRET: secret },
			encoding: 'utf8'
		}).trim();
		const shortId = shortUrl.split('/').at(-1)!;
		// Short ID should be 8 base64url characters
		expect(shortId.length).toBeLessThanOrEqual(10);
		expect(_pathFromToken(shortId, secret)).toBe(realpathSync(fixture));

		const longUrl = execFileSync(cli, ['--long', fixture], {
			env: { ...process.env, ONLINE_REVIEW_URL_SECRET: secret },
			encoding: 'utf8'
		}).trim();
		const longToken = longUrl.split('/').at(-1)!;
		expect(longToken.length).toBeGreaterThan(50);
		expect(_pathFromToken(longToken, secret)).toBe(realpathSync(fixture));
	});

	it('supports single PDF file and serves it via pdf endpoint', async () => {
		const secret = 'test-secret-pdf';
		const pdfPath = '/tmp/live-test-doc.pdf';
		writeFileSync(pdfPath, MINIMAL_PDF);
		const originalSecret = process.env.ONLINE_REVIEW_URL_SECRET;
		process.env.ONLINE_REVIEW_URL_SECRET = secret;

		try {
			const url = execFileSync(cli, [pdfPath], {
				env: { ...process.env, ONLINE_REVIEW_URL_SECRET: secret },
				encoding: 'utf8'
			}).trim();

			const token = url.split('/').at(-1)!;
			const paths = _pathsFromToken(token, secret);
			expect(paths).toEqual([realpathSync(pdfPath)]);

			// Test server load
			const pageData = load({
				params: { token },
				setHeaders: () => {}
			} as any);

			expect(pageData).toMatchObject({
				kind: 'pdf',
				token,
				filename: 'live-test-doc.pdf',
				src: `/live/${token}/pdf?v=${liveSnapshot(token).version}`
			});

			// Test pdf server route GET
			const res = await getPdf({
				params: { token },
				url: new URL(`https://example.com/live/${token}/pdf`)
			} as any);
			expect(res.status).toBe(200);
			expect(res.headers.get('cache-control')).toBe('no-store');
			expect(res.headers.get('content-type')).toBe('application/pdf');
			const buffer = Buffer.from(await res.arrayBuffer());
			expect(buffer.equals(MINIMAL_PDF)).toBe(true);
		} finally {
			process.env.ONLINE_REVIEW_URL_SECRET = originalSecret;
			try { unlinkSync(pdfPath); } catch {}
		}
	});

	it('supports single Word (.docx) file and serves it via word endpoint', async () => {
		const secret = 'test-secret-word';
		const docxPath = '/tmp/live-test-doc.docx';
		const zip = new JSZip();
		zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
		zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
		zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello ReviewLoop Word Test</w:t></w:r></w:p></w:body></w:document>');
		const minimalDocx = await zip.generateAsync({ type: 'nodebuffer' });
		writeFileSync(docxPath, minimalDocx);

		const originalSecret = process.env.ONLINE_REVIEW_URL_SECRET;
		process.env.ONLINE_REVIEW_URL_SECRET = secret;

		try {
			const url = execFileSync(cli, [docxPath], {
				env: { ...process.env, ONLINE_REVIEW_URL_SECRET: secret },
				encoding: 'utf8'
			}).trim();

			const token = url.split('/').at(-1)!;
			const paths = _pathsFromToken(token, secret);
			expect(paths).toEqual([realpathSync(docxPath)]);

			// Test server load
			const pageData = load({
				params: { token },
				setHeaders: () => {}
			} as any);

			expect(pageData).toMatchObject({
				kind: 'word',
				token,
				filename: 'live-test-doc.docx',
				src: `/live/${token}/word?v=${liveSnapshot(token).version}`
			});

			// Test word server route GET
			const res = await getWord({
				params: { token },
				url: new URL(`https://example.com/live/${token}/word`)
			} as any);
			expect(res.status).toBe(200);
			expect(res.headers.get('cache-control')).toBe('no-store');
			expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
			const buffer = Buffer.from(await res.arrayBuffer());
			expect(buffer.equals(minimalDocx)).toBe(true);
		} finally {
			process.env.ONLINE_REVIEW_URL_SECRET = originalSecret;
			try { unlinkSync(docxPath); } catch {}
		}
	});

	it('supports single PowerPoint (.pptx) file and serves it via ppt endpoint', async () => {
		const secret = 'test-secret-ppt';
		const pptxPath = '/tmp/live-test-deck.pptx';
		const zip = new JSZip();
		zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
		zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
		zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldMasterIdLst/>
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`);
		zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`);
		zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Quarterly Review Deck</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`);
		const minimalPptx = await zip.generateAsync({ type: 'nodebuffer' });
		writeFileSync(pptxPath, minimalPptx);

		const originalSecret = process.env.ONLINE_REVIEW_URL_SECRET;
		process.env.ONLINE_REVIEW_URL_SECRET = secret;

		try {
			const url = execFileSync(cli, [pptxPath], {
				env: { ...process.env, ONLINE_REVIEW_URL_SECRET: secret },
				encoding: 'utf8'
			}).trim();

			const token = url.split('/').at(-1)!;
			const paths = _pathsFromToken(token, secret);
			expect(paths).toEqual([realpathSync(pptxPath)]);

			// Test server load
			const pageData = load({
				params: { token },
				setHeaders: () => {}
			} as any);

			expect(pageData).toMatchObject({
				kind: 'ppt',
				token,
				filename: 'live-test-deck.pptx',
				src: `/live/${token}/ppt?v=${liveSnapshot(token).version}`
			});

			// Test ppt server route GET
			const res = await getPpt({
				params: { token },
				url: new URL(`https://example.com/live/${token}/ppt`)
			} as any);
			expect(res.status).toBe(200);
			expect(res.headers.get('cache-control')).toBe('no-store');
			expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
			const buffer = Buffer.from(await res.arrayBuffer());
			expect(buffer.equals(minimalPptx)).toBe(true);
		} finally {
			process.env.ONLINE_REVIEW_URL_SECRET = originalSecret;
			try { unlinkSync(pptxPath); } catch {}
		}
	});

	it('supports single Excel (.xlsx) file and serves it via excel endpoint', async () => {
		const secret = 'test-secret-excel';
		const xlsxPath = '/tmp/live-test-sheet.xlsx';
		const wb = XLSX.utils.book_new();
		const ws = XLSX.utils.aoa_to_sheet([
			['Quarter', 'Revenue', 'Cost'],
			['Q1', 12000, 8000],
			['Q2', 15000, 9500]
		]);
		XLSX.utils.book_append_sheet(wb, ws, 'SalesData');
		const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
		writeFileSync(xlsxPath, buffer);

		const originalSecret = process.env.ONLINE_REVIEW_URL_SECRET;
		process.env.ONLINE_REVIEW_URL_SECRET = secret;

		try {
			const url = execFileSync(cli, [xlsxPath], {
				env: { ...process.env, ONLINE_REVIEW_URL_SECRET: secret },
				encoding: 'utf8'
			}).trim();

			const token = url.split('/').at(-1)!;
			const paths = _pathsFromToken(token, secret);
			expect(paths).toEqual([realpathSync(xlsxPath)]);

			// Test server load
			const pageData = load({
				params: { token },
				setHeaders: () => {}
			} as any);

			expect(pageData).toMatchObject({
				kind: 'excel',
				token,
				filename: 'live-test-sheet.xlsx',
				src: `/live/${token}/excel?v=${liveSnapshot(token).version}`
			});

			// Test excel server route GET
			const res = await getExcel({
				params: { token },
				url: new URL(`https://example.com/live/${token}/excel`)
			} as any);
			expect(res.status).toBe(200);
			expect(res.headers.get('cache-control')).toBe('no-store');
			expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
			const resBuf = Buffer.from(await res.arrayBuffer());
			expect(resBuf.equals(buffer)).toBe(true);
		} finally {
			process.env.ONLINE_REVIEW_URL_SECRET = originalSecret;
			try { unlinkSync(xlsxPath); } catch {}
		}
	});

	it('supports CSV (.csv) spreadsheet and serves it via excel endpoint', async () => {
		const secret = 'test-secret-csv';
		const csvPath = '/tmp/live-test-sheet.csv';
		const csvContent = 'Item,Price,Quantity\nApple,5,10\nBanana,3,20\n';
		writeFileSync(csvPath, csvContent, 'utf8');

		const originalSecret = process.env.ONLINE_REVIEW_URL_SECRET;
		process.env.ONLINE_REVIEW_URL_SECRET = secret;

		try {
			const url = execFileSync(cli, [csvPath], {
				env: { ...process.env, ONLINE_REVIEW_URL_SECRET: secret },
				encoding: 'utf8'
			}).trim();

			const token = url.split('/').at(-1)!;
			const paths = _pathsFromToken(token, secret);
			expect(paths).toEqual([realpathSync(csvPath)]);

			// Test server load
			const pageData = load({
				params: { token },
				setHeaders: () => {}
			} as any);

			expect(pageData).toMatchObject({
				kind: 'excel',
				token,
				filename: 'live-test-sheet.csv',
				src: `/live/${token}/excel?v=${liveSnapshot(token).version}`
			});

			// Test excel server route GET
			const res = await getExcel({
				params: { token },
				url: new URL(`https://example.com/live/${token}/excel`)
			} as any);
			expect(res.status).toBe(200);
			expect(res.headers.get('cache-control')).toBe('no-store');
			expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
			const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
			expect(text).toBe(csvContent);
		} finally {
			process.env.ONLINE_REVIEW_URL_SECRET = originalSecret;
			try { unlinkSync(csvPath); } catch {}
		}
	});
});



 it.each(['html', 'htm', 'HTML'])('publishes immutable %s previews without restricting JavaScript', async (extension) => {
  const file = `${feedbackDirectory}/page.${extension}`;
  const source = '<!doctype html><style>h1{color:red}</style><h1>Hello HTML</h1><script>parent.hacked=true</script>';
  writeFileSync(file, source);
  const old = process.env.ONLINE_REVIEW_URL_SECRET;
  process.env.ONLINE_REVIEW_URL_SECRET = 'html-test';
  try {
   const url = execFileSync(cli, [file, '--long', '--local'], {env:{...process.env}, encoding:'utf8'}).trim();
   const token = url.split('/').at(-1)!;
   unlinkSync(file);
   expect(load({params:{token},setHeaders:()=>{}} as any)).toMatchObject({kind:'html',filename:`page.${extension}`});
   const response = await getHtml({params:{token}} as any);
   expect(await response.text()).toBe(source);
   expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
   expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
   expect(response.headers.get('cache-control')).toBe('no-store');
  } finally { if(old===undefined)delete process.env.ONLINE_REVIEW_URL_SECRET;else process.env.ONLINE_REVIEW_URL_SECRET=old; }
 });
