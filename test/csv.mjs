import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setFlagsFromString } from 'node:v8';
import { performance } from 'node:perf_hooks';
import { readCsv } from '../vendor/csv-reader/index.js';

// node test/csv.mjs
// node --expose-gc test/csv.mjs bench [path-to-baseline [path-to-candidate]]
setFlagsFromString('--no-incremental-marking');
const benchmark = process.argv[2] === 'bench';
async function loadSolver(path) {
  return (await import(path
    ? pathToFileURL(resolve(path)).href
    : new URL('../solve.js', import.meta.url).href)).run;
}
const run = await loadSolver(process.argv[benchmark ? 4 : 3]);

let checks = 0;
function check(text, header) {
  assert.deepEqual(run({ text, header }), readCsv({ text, header }), JSON.stringify({ text, header }));
  checks++;
}

if (!benchmark) {
  const alphabet = ['a', ',', '"', '\r', '\n'];
  let level = [''];
  for (let length = 0; length <= 6; length++) {
    for (const text of level) {
      check(text, false);
      check(text, true);
    }
    if (length < 6) level = level.flatMap(text => alphabet.map(char => text + char));
  }
  let seed = 0x7ce123ab;
  function random(bound) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % bound;
  }
  const tokens = [...alphabet, '\ufeff', '🙂', '\0', 'é', '\ud800', '\u2028', ' xyz ', '\r\n', '""'];
  for (let i = 0; i < 10000; i++) {
    let text = '';
    const length = random(180);
    for (let j = 0; j < length; j++) text += tokens[random(tokens.length)];
    check(text, Boolean(i % 2));
  }
  for (const text of [undefined, null, 42, false, ['a', 'b'], {}]) {
    check(text, true);
    check(text, 'true');
  }
  for (const text of [
    '"\n'.repeat(1000),
    'long field '.repeat(100000) + ',end',
    'head,er\r\n"' + '🙂é\r\n'.repeat(5000) + '""",ok\r\n',
    '\r\n\r\r\n\uFEFF\r\n"",\r,"next"\rjunk',
    ...[30, 31, 32, 33, 34, 65].flatMap(length =>
      [',', '\r', '\r\n', '\n', ''].map(end => 'x'.repeat(length) + end)),
  ]) {
    check(text, true);
    check(text, false);
  }
  console.log(`${checks.toLocaleString('en-US')} differential cases passed`);
} else {
  const baseline = process.argv[3] ? await loadSolver(process.argv[3]) : readCsv;
  const cases = [
    ['plain', 'alpha,bravo,charlie,delta,echo,foxtrot\n', 18000],
    ['short fields', '1,2,3,4,5,6,7,8\n', 24000],
    ['quoted', '"a,b","escaped ""quote""","line\r\nbreak",last\r\n', 12000],
    ['malformed', 'a,b,c\r\n"junk"tail,mid\rdle\nextra,x,y,z\n\n', 10000],
    ['long fields', 'abcdefghij'.repeat(250) + ',end\n', 400],
    ['unterminated', '"'.padEnd(120, 'x') + ',a,b\n', 5000],
  ];
  console.log(process.version);
  const workloads = cases.map(([name, row, count]) =>
    [name, row.repeat(count) + (name === 'unterminated' ? '"' : '')]);
  for (const quoted of [false, true]) {
    const lines = ['id,name,group,region,active'];
    for (let i = 0; i < 20000; i++) {
      const name = quoted && i % 8 === 0 ? `"item ${i}, south"` : `item ${i}`;
      lines.push(`${i},${name},group ${i % 37},region ${i % 11},${Boolean(i % 2)}`);
    }
    workloads.push([quoted ? 'varied mixed' : 'varied plain', lines.join('\n')]);
  }
  workloads.push(['varied CRLF', workloads.at(-2)[1].replaceAll('\n', '\r\n')]);
  console.log('Workload         Baseline    Candidate    Speedup');
  for (const [name, text] of workloads) {
    const input = { text, header: true };
    const reference = readCsv(input);
    assert.deepEqual(run(input), reference);
    assert.deepEqual(baseline(input), reference);
    const solvers = [baseline, run];
    const samples = [[], []];
    for (let i = 0; i < 12; i++) {
      baseline(input);
      run(input);
    }
    for (let sample = 0; sample < 9; sample++) {
      for (const index of sample % 2 === 0 ? [0, 1] : [1, 0]) {
        const solve = solvers[index];
        let observed = 0;
        globalThis.gc?.();
        const start = performance.now();
        for (let i = 0; i < 15; i++) observed += solve(input).rows.length;
        samples[index].push((performance.now() - start) / 15);
        assert.equal(observed, reference.rows.length * 15);
      }
    }
    const [before, after] = samples.map(values => values.sort((a, b) => a - b)[4]);
    console.log(name.padEnd(14), before.toFixed(3).padStart(8) + ' ms',
      after.toFixed(3).padStart(8) + ' ms', (before / after).toFixed(2) + 'x');
  }
}
