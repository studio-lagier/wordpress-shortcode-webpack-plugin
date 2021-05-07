import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { merge } from 'webpack-merge';
import webpack, { Compiler, Configuration } from 'webpack';
import { ExecutionContext } from 'ava';
import {
  PluginOptions,
  WordpressShortcodeWebpackPlugin,
} from '../src';

const { log } = console;

const applyDefaults = (
  webpackOpts: Partial<Configuration>
) => {
  const defaults: Partial<Configuration> = {
    optimization: {
      chunkIds: 'natural',
    },
    output: {
      publicPath: '',
    },
  };
  return merge(defaults, webpackOpts);
};

export const hashLiteral =
  !webpack.version || webpack.version.startsWith('4')
    ? '[hash]'
    : '[fullhash]';

export const prepare = (
  webpackOpts: Partial<Configuration>
) => {
  if (Array.isArray(webpackOpts)) {
    return webpackOpts.map((opts) => applyDefaults(opts));
  }

  return [applyDefaults(webpackOpts)];
};

export const compile = (
  config: Partial<Configuration>,
  compilerOps: Partial<Compiler> = {},
  t: ExecutionContext
) => {
  const compiler = webpack(prepare(config));

  Object.assign(compiler, compilerOps);

  return new Promise((resolve) => {
    compiler.run((error, stats) => {
      t.falsy(error);
      if (stats?.hasErrors()) {
        log(stats.toJson());
      }
      t.is(stats?.hasErrors(), false);
      resolve(stats);
    });
  });
};

export const readJson = (path: string) => {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content);
};

export const writeFile = (
  fileName: string,
  content: string
) => {
  mkdirSync(dirname(fileName), { recursive: true });
  writeFileSync(fileName, content);
};

export async function compileWithOptions(
  options: PluginOptions,
  outputPath: string,
  t: ExecutionContext
) {
  await compile(
    {
      entry: resolve(__dirname, './fixtures/index.js'),
      context: __dirname,
      output: {
        filename: '[name].js',
        path: outputPath,
      },
      plugins: [
        new WordpressShortcodeWebpackPlugin(options),
      ],
    },
    {},
    t
  );
}
