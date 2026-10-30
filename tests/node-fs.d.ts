/** Déclaration minimale (tests uniquement) : évite d'ajouter @types/node pour lire un fichier. */
declare module 'node:fs' {
  interface BinaryFile {
    length: number;
    toString(encoding: 'ascii', start: number, end: number): string;
    readUInt32LE(offset: number): number;
    readInt16LE(offset: number): number;
  }
  export function readFileSync(path: URL): BinaryFile;
}
