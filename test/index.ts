import test from 'ava';
import { compile } from './utils.js';
import del from 'del';
import { join, resolve } from 'path';
import { readFileSync } from 'fs';
import { WordpressShortcodeWebpackPlugin } from '../src/index.js';

const outputPath = join(__dirname, './output/single-file');

test.beforeEach(() => {
  del(outputPath);
});

test('Files are created', async (t) => {
  await compile(
    {
      entry: resolve(__dirname, './fixtures/index.js'),
      context: __dirname,
      output: {
        filename: '[name].js',
        path: outputPath,
      },
      plugins: [
        new WordpressShortcodeWebpackPlugin({
          wordpressPluginName: 'my-plugin',
          headerFields: {
            license: 'MIT',
            author: 'Tom Lagier',
            version: '1.2.3',
            description: 'Does a cool trick',
          },
        }),
      ],
    },
    {},
    t
  );

  const pluginPath = join(
    outputPath,
    'my-plugin/my-plugin.php'
  );
  const file = readFileSync(pluginPath);

  t.is(file.indexOf('main.js') > -1, true);
});
