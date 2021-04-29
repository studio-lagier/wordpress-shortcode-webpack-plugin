// Needed for type info
import fs from 'fs';
import path from 'path';
import yazl from 'yazl';

export function readFile(
  _fs: any, // InputFileSystem from Webpack, not exported :(
  path: string
): string {
  return _fs.readFileSync!(path, 'utf8');
}

export function kebabToTitle(str: string) {
  return str
    .split('-')
    .map(([first, ...rest]) =>
      [first.toUpperCase(), ...rest].join('')
    )
    .join(' ');
}

export function kebabToSnake(str: string) {
  return str.replace('-', '_');
}

export function jsObjectToPhpArray(
  jsObj: Object,
  indent = 1,
  last = false
): string {
  let template = addToken('[', last ? indent - 1 : indent);
  for (const [key, value] of Object.entries(jsObj)) {
    template += getPhpRepresentation(
      key,
      value,
      indent + 1
    );
  }
  const finalToken = last ? '];' : '],';

  template += addToken(finalToken, indent, !last);

  return template;
}

function getPhpRepresentation(
  key: string,
  value: any,
  indent: number
): string {
  if (isPrimitive(value)) {
    const keyVal = `'${key}' => '${value}',`;
    return addToken(keyVal, indent);
  }

  if (Array.isArray(value)) {
    let template = addToken(`'${key}' => [`, indent);

    for (const val of value) {
      template += arrayToken(val, indent + 1);
    }

    template += addToken(`],`, indent);
    return template;
  }

  if (typeof value === 'object') {
    const phpArray = jsObjectToPhpArray(value, indent + 1);
    return addToken(`'${key}' => ${phpArray}`, indent);
  }

  throw new Error('Invalid value');
}

function arrayToken(value: any, indent: number): string {
  if (isPrimitive(value)) {
    return addToken(`'${value}',`, indent);
  }

  if (Array.isArray(value)) {
    let template = addToken(`[`, indent);
    for (const val of value) {
      template += arrayToken(val, indent + 1);
    }
    template += addToken(`],`, indent);
    return template;
  }

  if (typeof value === 'object') {
    return jsObjectToPhpArray(value, indent);
  }

  throw new Error('Invalid value');
}

function addToken(
  token: string,
  indent: number,
  newline = true
) {
  const space = getTabs(indent);

  return `${space}${token}${newline ? '\n' : ''}`;
}

function isPrimitive(val: any) {
  const isPrimitive =
    val && !Array.isArray(val) && typeof val !== 'object';

  return isPrimitive;
}

export function indentText(str: string, amount: number) {
  return str
    .split('\n')
    .map((line) => `${getTabs(amount)}${line}`)
    .join('\n');
}

export function getTabs(num: number) {
  return Array.from(new Array(num))
    .map((_) => `\t`)
    .join('');
}

export async function addDirectory(
  zip: yazl.ZipFile,
  realPath: string,
  metadataPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.readdir(realPath, async function (error, files) {
      if (error == null) {
        for (const file of files) {
          await addDirectory(
            zip,
            path.join(realPath, file),
            path.join(metadataPath, file)
          );
        }
      } else if (error.code === 'ENOTDIR') {
        zip.addFile(realPath, metadataPath);
        return resolve();
      } else {
        return reject(error);
      }
    });
  });
}
