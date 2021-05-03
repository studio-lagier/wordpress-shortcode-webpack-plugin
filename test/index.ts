import test from 'ava';
import { compileWithOptions } from './utils.js';
import del from 'del';
import { join, resolve } from 'path';
import { readFileSync } from 'fs';
import { sync as ls } from 'glob';

const outputPath = join(__dirname, './output');
const pluginName = 'my-plugin';

function getPaths(testName: string) {
  const testPath = join(outputPath, testName);
  const pluginPath = join(testPath, pluginName);
  const pluginFilePath = join(
    pluginPath,
    `${pluginName}.php`
  );

  return {
    testPath,
    pluginPath,
    pluginFilePath,
  };
}

test.before(async () => {
  del(outputPath);
});

test('Plugin file is created', async (t) => {
  const { testPath, pluginFilePath } = getPaths(
    'file-created'
  );
  await compileWithOptions(
    {
      wordpressPluginName: pluginName,
    },
    testPath,
    t
  );

  // Snapshot the generated plugin file
  const plugin = readFileSync(pluginFilePath, 'utf-8');
  const hasMainEntry = plugin.indexOf('main.js') > -1;
  t.is(hasMainEntry, true);
  t.snapshot(plugin);
});

test('Directory structure is correct', async (t) => {
  const { testPath, pluginPath } = getPaths(
    'structure-correct'
  );

  await compileWithOptions(
    {
      wordpressPluginName: pluginName,
    },
    testPath,
    t
  );

  const expectedOutput = [
    'my-plugin.zip',
    'my-plugin/my-plugin.php',
    'my-plugin/assets/main.js',
  ].map((file) => join(testPath, file));

  const outputFiles = ls(`${pluginPath}/**`, {
    nodir: true,
  });

  t.is(outputFiles.length, 2);

  for (const file of outputFiles) {
    t.is(expectedOutput.includes(file), true);
  }
});

test('Plugin header is generated correctly', async (t) => {
  const { testPath, pluginFilePath } = getPaths(
    'correct-header'
  );

  await compileWithOptions(
    {
      wordpressPluginName: pluginName,
      headerFields: {
        pluginUri: 'https://foo.bar',
        description: 'A test plugin',
        version: '1.2.3',
        requiredWordpressVersion: '1.0.0',
        requiredPHPVersion: '1.3.4',
        author: 'Tom Lagier',
        authorUri: 'https://lagiers.studio',
        license: 'MIT',
        licenseUri: 'https://mit.license',
        textDomain: 'https://foo.bar',
        domainPath: 'https://bar.baz',
        isNetworkWide: true,
      },
    },
    testPath,
    t
  );

  const plugin = readFileSync(pluginFilePath, 'utf-8');
  const expected = `
   * Plugin Name: My Plugin
   * Plugin URI: https://foo.bar
   * Description: A test plugin
   * Version: 1.2.3
   * Requires at least: 1.0.0
   * Requires PHP: 1.3.4
   * Author: Tom Lagier
   * Author URI: https://lagiers.studio
   * License: MIT
   * License URI: https://mit.license
   * Text Domain: https://foo.bar
   * Domain Path: https://bar.baz
   * Network: true`;

  const containsExpected = plugin.indexOf(expected) > -1;
  t.is(containsExpected, true);
});

test('Shortcode prefix is used if provided', async (t) => {
  const { testPath, pluginFilePath } = getPaths(
    'shortcode-prefix'
  );

  await compileWithOptions(
    {
      wordpressPluginName: pluginName,
      shortcodePrefix: 'foo',
    },
    testPath,
    t
  );

  const plugin = readFileSync(pluginFilePath, 'utf-8');
  const containsCorrectShortcode =
    plugin.indexOf(
      `add_shortcode('foo-main', 'create_main_app');`
    ) > -1;

  t.is(containsCorrectShortcode, true);
});

test('Plugin template is used if provided', async (t) => {
  const { testPath, pluginFilePath } = getPaths(
    'plugin-template'
  );

  await compileWithOptions(
    {
      wordpressPluginName: pluginName,
      pluginTemplate: resolve(
        __dirname,
        // We just read any old file, all we care about is that
        // we can point it at a different one.
        'fixtures/test-template.js'
      ),
    },
    testPath,
    t
  );

  const plugin = readFileSync(pluginFilePath, 'utf-8');
  t.snapshot(plugin);
});

test('Entry to root ID map is honored', async (t) => {
  const { testPath, pluginFilePath } = getPaths(
    'entry-to-root'
  );

  await compileWithOptions(
    {
      wordpressPluginName: pluginName,
      entryToRootId: {
        main: 'some-id',
      },
    },
    testPath,
    t
  );

  const plugin = readFileSync(pluginFilePath, 'utf-8');
  t.snapshot(plugin);
});
