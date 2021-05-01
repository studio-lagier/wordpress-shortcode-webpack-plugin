# WordpressShortcodeWebpackPlugin

This Webpack plugin is for Wordpress developers who want an easy way to drop React apps
into Wordpress pages. It creates a simple Wordpress plugin from your Webpack configuration,
registering each Webpack entry as a Wordpress shortcode.

## Installation

```bash
  npm install wordpress-shortcode-webpack-plugin
```

## Usage

Import the plugin, tell it a bit about your desired Wordpress plugin output, and
add it to your Webpack configuration.

`webpack.config.js`

```javascript
import { WordpressShortcodeWebpackPlugin } from 'wordpress-shortcode-webpack-plugin';

export default {
    entry: './src/index.js',
    output: {
        filename: '[name].js',
    },
    plugins: [
        new WordpressShortcodeWebpackPlugin({
            // The name of the plugin in Wordpress. Should be kebab-cased
            wordpressPluginName: 'my-awesome-plugin',
            // Any additional fields to put in the plugin header.
            headerFields: {
                author: 'Tom Lagier',
                description: 'An awesome plugin that does many cool things'
                // Note: Defining a version isn't necessary for Wordpress cache-busting
                // if you're using [contenthash] tokens in your output. It can still be
                // nice to set a version for communicating changes to users.
                version: '1.2.3'
            }
        }),
    ],
}
```

When built, this will output the following assets in the build directory:

```
my-awesome-plugin/
  // The main Wordpress plugin file
  my-awesome-plugin.php
  assets/
    main.js
    ... other assets produced by Webpack

// Archive of the plugin that you can install to Wordpress
my-awesome-plugin.zip
```

Once uploaded, you can use the entrypoints specified in your Webpack configuration as shortcodes.
By default the shortcodes are registered as `{pluginName}-{entryName}`. For our example, the one
shortcode registered would be `my-awesome-plugin-main`.

So, in Wordpress, we could use the shortcode like `[my-awesome-plugin-main]`.

## Options

### `wordpressPluginName` (required)

**Type:** `string`

Your plugin's name in kebab-case.

### `shortcodePrefix`

**Type:** `string`

**Default:** `wordpressPluginName`

The prefix used instead of `wordpressPluginName` to create your shortcodes.
With `shortcodePrefix: 'my-shortcode'`, the `main` entry shortcode would
be `[my-shortcode-main]`.

### `headerFields`

**Type:**

```
{
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
```

**Default:** `{}`

Header fields for the Wordpress plugin.
See https://developer.wordpress.org/plugins/plugin-basics/header-requirements/#header-fields

### entryToRootId

**Type:** `object`

**Default:** `{}`

A map of overrides for the root element ID for each entrypoint. By default we just use `root` as
the ID for the root element, per React convention. If that ID conflicts with something else on the page,
you can adjust it with this map.

```
{
    main: 'new-main-root-id'
}
```

### `pluginTemplate`

**Type:** `string`

**Default:** `./src/default-template.php` (in the wordpress-shortcode-webpack-plugin repo)

Path to the template file that should be used to generate the Wordpress plugin file.

The template file is a PHP file with the following tokens that get replaced with content. You can
customize the behavior of the Wordpress plugin by modifying the template.

#### `{{plugin_header}}`

Replaced with the Wordpress comment indicating the plugin name and other plugin metadata.

```
/**
 * Plugin Name: My Plugin
 */
```

#### `{{asset_manifest}}`

Replaced with an associative array of entrypoint to an array of files that should be loaded
for that entrypoint. Required for `{{shortcode_registration}}` and `{{shortcode_definitions}}`.

```
$manifest = [
    'main' => [
        'main.js',
    ],
];
```

#### `{{shortcode_definitions}}`

Function that is invoked when the shortcode is called. Enqueues the assets for the entry
and returns the React root HTML as a string.

Override this if you'd like to enhance the logic that gets run when your shortcode is run,
e.g. by supplying attributes or setting global variables in the markup.

The naming convention for shortcodes that get registered is `create_{entry}_app`.

Requires `{{shortcode_registration}}`.

```
function create_main_app() {
    enqueue_assets('main');

    return '<div id="root"></div>';
}
```

#### `{{shortcode_registration}}`

Function that registers the shortcode definition functions and their assets with Wordpress.

```
function register_my_plugin_entries() {
    add_shortcode('my-plugin-main', 'create_main_app');
    register_assets('main');
}
```

#### `{{add_action}}`

Adds the `{{shortcode_registration}}` function as an action during Wordpress's `init` phase.

```
add_action('init', 'register_my_plugin_entries');
```

## Build locally

Clone the project

```bash
  git clone https://github.com/studio-lagier/wordpress-shortcode-webpack-plugin
```

Go to the project directory

```bash
  cd wordpress-shortcode-webpack-plugin
```

Install dependencies

```bash
  npm install
```

Build

```bash
  npm run build
```

## Running Tests

To run tests, run the following command

```bash
  npm run test
```

## License

[MIT](https://choosealicense.com/licenses/mit/)
