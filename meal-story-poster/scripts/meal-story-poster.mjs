#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { inspectAssets, prepareContent, today, defaultOutputDirectory } from './lib/io.mjs';
import { build, validateOutput, exportPublic } from './lib/pipeline.mjs';

const help = `meal-story-poster — 本地餐食图文（Node.js >=22）

inspect  --input 照片目录
prepare  --input 照片目录 [--analysis analysis.json] [--output content.json]
build    --input 照片目录 --content content.json [--output 新批次目录] [--as-of YYYY-MM-DD] [--keep-state]
validate --output 批次目录
export   --output 批次目录 --approval 人工批准.json --destination 新公开目录

prepare/build 默认在本 Skill 的 outputs/ 下自动创建独立批次，并返回实际路径。
build 默认只保留中文海报与一份发布文案.txt；检查在内存完成，不生成 HTML 或隐藏审核文件。
需要事后事实复核或公开导出时，用 --keep-state 额外保存一个任务状态.json。
validate 对无状态批次只检查成品文件；有状态时完整核对事实、源图与成品。
全部结果仍为内部草稿。prepare 不覆盖已有文件，build/export 拒绝非空目录。
识别由 Codex 看图或人工填写，脚本不根据文件名猜测菜名或许可。
模板、文案目标、日期、门店、裁切及逐素材隐私记录在 content.json 中配置。
export 仅导出审核摘要匹配的海报和汇总文案，不发布到任何平台。`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    input: { type: 'string' }, content: { type: 'string' }, output: { type: 'string' }, analysis: { type: 'string' },
    'as-of': { type: 'string' }, 'keep-state': { type: 'boolean' }, approval: { type: 'string' }, destination: { type: 'string' }, help: { type: 'boolean', short: 'h' }
  } });
  const command = positionals[0];
  if (values.help || !command) { console.log(help); }
  else {
    const requireFields = names => { for (const name of names) if (!values[name]) throw new Error(`缺少 --${name}`); };
    const allowed = {
      inspect: ['input'], prepare: ['input', 'output', 'analysis'], build: ['input', 'content', 'output', 'as-of', 'keep-state'],
      validate: ['output'], export: ['output', 'approval', 'destination']
    };
    if (!allowed[command] || positionals.length !== 1) throw new Error('未知命令；使用 --help 查看用法');
    for (const name of Object.keys(values)) if (!allowed[command].includes(name)) throw new Error(`${command} 不支持 --${name}`);
    if (command === 'inspect') { requireFields(['input']); console.log(JSON.stringify(await inspectAssets(values.input), null, 2)); }
    if (command === 'prepare') {
      requireFields(['input']);
      const outputFile = values.output ?? path.join(defaultOutputDirectory('prepare'), 'content.json');
      const content = await prepareContent(await inspectAssets(values.input), outputFile, values.analysis);
      console.log(JSON.stringify({ file: path.resolve(outputFile), assetCount: content.assets.length, reviewStatus: 'draft' }));
    }
    if (command === 'build') {
      requireFields(['input', 'content']);
      const qa = await build({ input: values.input, contentFile: values.content, output: values.output, asOf: values['as-of'] ?? today(), keepState: values['keep-state'] === true });
      console.log(JSON.stringify({ output: qa.outputDirectory, posters: qa.pages.filter(p => p.status === 'generated').flatMap(p => p.outputFiles.map(f => path.join(qa.outputDirectory, f.file))), copy: qa.copyFile, ...(qa.stateFile ? { state: qa.stateFile } : {}), passed: qa.passed, errors: qa.errors, warnings: qa.warnings, bundleDigest: qa.bundleDigest, reviewStatus: 'draft' }, null, 2));
      if (!qa.passed) process.exitCode = 2;
    }
    if (command === 'validate') { requireFields(['output']); const qa = await validateOutput(values.output); console.log(JSON.stringify(qa, null, 2)); if (!qa.passed) process.exitCode = 2; }
    if (command === 'export') { requireFields(['output', 'approval', 'destination']); console.log(JSON.stringify(await exportPublic({ output: values.output, approvalFile: values.approval, destination: values.destination }), null, 2)); }
  }
} catch (error) { console.error(`meal-story-poster: ${error.message}`); process.exitCode = 1; }
