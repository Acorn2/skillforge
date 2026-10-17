import path from 'node:path';
import fs from 'node:fs/promises';
import { skillRoot, writeJson } from '../scripts/lib/io.mjs';
import { build } from '../scripts/lib/pipeline.mjs';
import { fixture, AS_OF } from './helpers.mjs';

// All images are synthetic geometric test fixtures. No real meal photo was supplied.
const root = path.join(skillRoot, 'outputs', `synthetic-demo-${Date.now()}`);
const f = await fixture(root, [...Array(4).fill('ingredient'), ...Array(5).fill('finished-dish')], { review: false });
const qa = await build({ input: f.input, contentFile: f.contentFile, output: path.join(root, 'batch'), asOf: AS_OF });
await fs.writeFile(path.join(root, 'DEMO-NOTICE.txt'), '这是明确标注的合成几何图流程测试，未使用真实餐食照片，不能作为机构对外宣传素材。\n', { mode: 0o600 });
await writeJson(path.join(skillRoot, 'outputs/latest-demo.json'), { root, output: path.join(root, 'batch'), passed: qa.passed });
const manifest = { pages: qa.pages };
console.log(JSON.stringify({ root, passed: qa.passed, errors: qa.errors, pages: manifest.pages.map(p => ({ template: p.template, status: p.status })), realPhotoAcceptanceCompleted: false }, null, 2));
if (!qa.passed) process.exitCode = 2;
