import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import { merge } from 'webpack-merge';
import webpack, { Compiler, Configuration } from 'webpack';
import {ExecutionContext} from 'ava';

const { log } = console;

const applyDefaults = (webpackOpts: Partial<Configuration>) => {
  const defaults: Partial<Configuration> = {
    optimization: {
      chunkIds: 'natural'
    },
    output: {
      publicPath: ''
    }
  };
  return merge(defaults, webpackOpts);
};

export const hashLiteral = webpack.version.startsWith('4') ? '[hash]' : '[fullhash]';

export const prepare = (webpackOpts: Partial<Configuration>) => {
  if (Array.isArray(webpackOpts)) {
    return webpackOpts.map((opts) => applyDefaults(opts));
  }

  return [applyDefaults(webpackOpts)];
};

export const compile = (config: Partial<Configuration>, compilerOps: Partial<Compiler> = {}, t: ExecutionContext) => {
  const compiler = webpack(prepare(config));

  Object.assign(compiler, compilerOps);

  return new Promise((p) => {
    compiler.run((error, stats) => {
      t.falsy(error);
      if (stats?.hasErrors()) {
        log(stats.toJson());
      }
      t.is(stats?.hasErrors(), false);

      p(stats);
    });
  });
};

export const readJson = (path: string) => {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content);
};

export const watch = (config: Partial<Configuration>, t: ExecutionContext, cb: Function) => {
  const compiler = webpack(prepare(config));

  return compiler.watch(
    {
      aggregateTimeout: 300,
      poll: true
    },
    (err, stats) => {
      t.falsy(err);
      t.is(stats?.hasErrors(), false);

      cb(stats);
    }
  );
};

export const writeFile = (fileName: string, content: string) => {
  mkdirSync(dirname(fileName), { recursive: true });
  writeFileSync(fileName, content);
};