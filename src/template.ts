import {
  indentText,
  jsObjectToPhpArray,
  kebabToSnake,
  kebabToTitle,
} from './utils';
import { Manifest } from './index';
import { resolve } from 'path';

export interface PluginHeaderFields {
  pluginUri?: string;
  description?: string;
  version?: string;
  requiredWordpressVersion?: string;
  requiredPHPVersion?: string;
  author?: string;
  authorUri?: string;
  license?: string;
  licenseUri?: string;
  textDomain?: string;
  domainPath?: string;
  isNetworkWide?: boolean;
}

// Creates the Wordpress format plugin header so that
// Wordpress knows the plugin metadata.
export function createPluginHeader(
  opts: PluginHeaderFields & { pluginName: string }
): string {
  let header = `  /**
   * Plugin Name: ${kebabToTitle(opts.pluginName)}`;

  if (opts.pluginUri) {
    header += `
   * Plugin URI: ${opts.pluginUri}`;
  }

  if (opts.description) {
    header += `
   * Description: ${opts.description}`;
  }

  if (opts.version) {
    header += `
   * Version: ${opts.version}`;
  }

  if (opts.requiredWordpressVersion) {
    header += `
   * Requires at least: ${opts.requiredWordpressVersion}`;
  }

  if (opts.requiredWordpressVersion) {
    header += `
   * Requires PHP: ${opts.requiredPHPVersion}`;
  }

  if (opts.author) {
    header += `
   * Author: ${opts.author}`;
  }

  if (opts.authorUri) {
    header += `
   * Author URI: ${opts.authorUri}`;
  }

  if (opts.license) {
    header += `
   * License: ${opts.license}`;
  }

  if (opts.licenseUri) {
    header += `
   * License URI: ${opts.licenseUri}`;
  }

  if (opts.textDomain) {
    header += `
   * Text Domain: ${opts.textDomain}`;
  }

  if (opts.domainPath) {
    header += `
   * Domain Path: ${opts.domainPath}`;
  }

  if (opts.isNetworkWide) {
    header += `
   * Network: ${opts.isNetworkWide}`;
  }

  header += `
   */`;

  return header;
}

// Creates an asset manifest associative array as a PHP string
export function createAssetManifest(manifest: Manifest) {
  return `  $manifest = ${jsObjectToPhpArray(
    manifest.entries,
    1,
    true
  )}`;
}

export function createAddAction(pluginName: string) {
  return `  add_action('init', 'register_${kebabToSnake(
    pluginName
  )}_entries');`;
}

export function createShortcodeDefinitions(
  manifest: Manifest,
  entryToRoot: { [entry: string]: string } = {}
) {
  const functions = [];

  for (const entryName of Object.keys(manifest.entries)) {
    const rootId = entryToRoot[entryName] || 'root';

    // Write a function that creates the root element and enqueues the
    // assets for that entrypoint.
    const newFunc = `  function create_${entryName}_app() {
    enqueue_assets('${entryName}');

    return '<div id="${rootId}"></div>';
  }`;

    functions.push(newFunc);
  }

  return functions.join('\n');
}

export function createShortcodeRegistration(
  shortcodePrefix: string,
  pluginName: string,
  manifest: Manifest
): string {
  const addShortcodes = [];
  const registerAssets = [];

  for (const entryName of Object.keys(manifest.entries)) {
    addShortcodes.push(
      `add_shortcode('${shortcodePrefix}-${entryName}', 'create_${entryName}_app');`
    );

    registerAssets.push(`register_assets('${entryName}');`);
  }
  // Write a function that creates the root element and enqueues the
  // assets for that entrypoint.
  return `  function register_${kebabToSnake(
    pluginName
  )}_entries() {
${indentText(addShortcodes.join('\n'), 2)}
${indentText(registerAssets.join('\n'), 2)}
  }`;
}
