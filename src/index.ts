import { Compilation, Compiler } from 'webpack';
import {
  WebpackManifestPlugin,
  getCompilerHooks,
} from 'webpack-manifest-plugin';
import { v4 } from 'uuid';

import { resolve, join } from 'path';
import {
  PluginHeaderFields,
  generatePluginFile,
} from './template';
import yazl from 'yazl';
import {
  RawSource,
  RawSource as RawSourceV4,
} from 'webpack-sources';

export interface PluginOptions {
  // What to name the plugin.
  wordpressPluginName: string;
  // Prefix of the generated shortcodes. Defaults to `wordpressPluginName`.
  shortcodePrefix?: string;
  // Template of the plugin file that will be generated. Defaults to `default-template.php`.
  pluginTemplate?: string;
  // Header fields for the Wordpress plugin.
  // See https://developer.wordpress.org/plugins/plugin-basics/header-requirements/#header-fields
  headerFields?: PluginHeaderFields;
  // Map of entry point to root element ID.
  // Each root element defaults to id "root", unless an
  // alternate mapping is provided here.
  entryToRootId?: {
    [entry: string]: string;
  };
}

export interface Manifest {
  id: string;
  entries: {
    [key: string]: Entry;
  };
}

type Entry = string[];

export class WordpressShortcodeWebpackPlugin {
  constructor(public options: PluginOptions) {
    if (!options.wordpressPluginName) {
      throw new Error('wordpressPluginName is required');
    }

    const defaults = {
      shortcodePrefix: options.wordpressPluginName,
      pluginTemplate: resolve(
        __dirname,
        'default-template.php'
      ),
      headerFields: {},
      entryToRootId: {},
    };

    this.options = Object.assign({}, defaults, options);
  }

  apply(compiler: Compiler) {
    const pluginName = WordpressShortcodeWebpackPlugin.name;
    const { webpack } = compiler;
    const wpPluginName = this.options.wordpressPluginName;
    const dummyManifestFilename = v4();

    // Create a custom manifest using WebpackManifestPlugin.
    createManifestPlugin(
      dummyManifestFilename,
      wpPluginName,
      compiler
    );

    // Webpack 4
    if (!webpack.version) {
      compiler.hooks.emit.tap(pluginName, (compilation) =>
        compilationHooks(
          compilation,
          compiler,
          pluginName,
          wpPluginName,
          this.options
        )
      );
      // Webpack 5
    } else {
      compiler.hooks.thisCompilation.tap(
        pluginName,
        (compilation) =>
          compilationHooks(
            compilation,
            compiler,
            pluginName,
            wpPluginName,
            this.options
          )
      );
    }
  }
}

function compilationHooks(
  compilation: Compilation,
  compiler: Compiler,
  pluginName: string,
  wpPluginName: string,
  options: PluginOptions
) {
  const { beforeEmit, afterEmit } = getCompilerHooks(
    compiler
  );
  const { webpack } = compiler;
  const RawSource = webpack.sources
    ? webpack.sources.RawSource
    : RawSourceV4;

  // Naming convention required by Wordpress
  const outputFileName = join(
    wpPluginName,
    `${wpPluginName}.php`
  );

  beforeEmit.tap(pluginName, (manifest: Manifest) => {
    // This is the "main" file of the Wordpress plugin. We do all of the
    // work of applying our header, manifest, and loaders to the specified
    // template here.
    const pluginFile = generatePluginFile(
      wpPluginName,
      manifest,
      options,
      compiler
    );

    compilation.emitAsset(
      outputFileName,
      new RawSource(pluginFile)
    );

    const manifestFiles = Object.values(
      manifest.entries
    ).reduce((all, val) => [...all, ...val]);

    // We're also gonna fork all entry content into our plugin folder
    // We don't know what other apps are being deployed out of this build
    // folder so we opt to copy them.
    for (const chunk of compilation.chunks) {
      for (const file of chunk.files) {
        // Make sure we don't add anything that's not in our manifest.
        if (!manifestFiles.includes(file)) continue;

        const dupedFileName = join(
          wpPluginName,
          'assets',
          file
        );

        compilation.emitAsset(
          dupedFileName,
          new RawSource(compilation.assets[file].source())
        );
      }
    }
  });

  // We do this because we don't have a way to asynchronously process the output
  // generated during the `beforeEmit` hook provided by WebpackManifestPlugin.
  // So, we use the `additionalAssets` flag, which runs a second time
  // whenever any `processAssets` hook adds more files to the compilation.
  // This is a bit of a hack, and will be fixed by https://github.com/shellscape/webpack-manifest-plugin/pulls
  // See https://github.com/shellscape/webpack-manifest-plugin/issues/262 for more context.
  // We need to do asynchronous work because we want to create an archive
  // of the Wordpress plugin and all the good Zip libraries are either
  // promise or stream-based.
  compilation.hooks.processAssets.tapPromise(
    {
      stage:
        webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
      name: pluginName,
      additionalAssets: true,
    },
    async (assets) => {
      // We use this to test that this particular invocation of `processAssets` is
      // the one triggered by out `beforeEmit` hook.
      if (!assets[outputFileName]) return;

      const zipFile = await createZipFile(
        assets,
        wpPluginName
      );

      const zipFileName = `${wpPluginName}.zip`;
      compilation.emitAsset(
        zipFileName,
        new RawSource(zipFile)
      );
    }
  );

  // Clean up our manifest after we're done with it
  afterEmit.tap(pluginName, (manifest: Manifest) => {
    compilation.deleteAsset(manifest.id!);
  });
}

// We're going to create a new instance of WebpackManifestPlugin that allows us to create
// a manifest to our specifications. This is a simple way for us to figure out
// the "real" list of files that are generated in our build.
function createManifestPlugin(
  manifestName: string,
  wpPluginName: string,
  compiler: Compiler
) {
  new WebpackManifestPlugin({
    // We don't actually care about the file that gets written, we're going to make a unique name so we can delete it
    fileName: manifestName,
    basePath: `${wpPluginName}/assets`,
    generate: (_, __, entries) => {
      const entrypointFiles: {
        [key: string]: Entry;
      } = {};
      Object.keys(entries).forEach((entrypoint) => {
        entrypointFiles[entrypoint] = entries[
          entrypoint
        ].filter((fileName) => !fileName.endsWith('.map'));
      });

      return {
        entries: entrypointFiles,
        // Bit of a hack so we can clean this file up by ID later
        id: manifestName,
      };
    },
  }).apply(compiler);
}

async function createZipFile<T>(
  // Type CompilationAssets, but Webpack doesn't export the type :(
  assets: T,
  wpPluginName: string
): Promise<Buffer> {
  const archive = new yazl.ZipFile();

  for (const [assetPath, asset] of Object.entries(assets)) {
    // Make sure no other assets got caught up in this run
    if (!assetPath.startsWith(wpPluginName)) continue;

    // OK we're dealing with something we want to zip
    archive.addBuffer(
      asset.buffer(),
      // TODO: Clean this up
      assetPath.replace(`${wpPluginName}/`, '')
    );
  }

  archive.end();

  return new Promise((resolve, reject) => {
    const bufs: Buffer[] = [];
    archive.outputStream.on('data', (buf) =>
      bufs.push(buf)
    );

    archive.outputStream.on('error', (error) =>
      reject(error)
    );

    archive.outputStream.on('end', () => {
      const outFile = Buffer.concat(bufs);

      resolve(outFile);
    });
  });
}
