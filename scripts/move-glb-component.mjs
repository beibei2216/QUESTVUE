import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const input = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const targetRoot = Number.parseInt(process.argv[4], 10);
const delta = process.argv
  .slice(5, 8)
  .map((value) => Number.parseFloat(value));

if (!Number.isInteger(targetRoot) || delta.length !== 3 || delta.some(Number.isNaN)) {
  throw new Error('Usage: node move-glb-component.mjs input output componentRoot dx dy dz');
}

const bytes = readFileSync(input);
const jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
const binStart = 20 + jsonLength + 8;
const primitive = json.meshes[0].primitives[0];
const positionAccessor = json.accessors[primitive.attributes.POSITION];
const indexAccessor = json.accessors[primitive.indices];
const positionView = json.bufferViews[positionAccessor.bufferView];
const positionOffset =
  binStart + (positionView.byteOffset || 0) + (positionAccessor.byteOffset || 0);
const positionStride = positionView.byteStride || 12;
const indices = readAccessor(primitive.indices);
const parents = new Uint32Array(positionAccessor.count);
const sizes = new Uint32Array(positionAccessor.count);

for (let index = 0; index < parents.length; index += 1) {
  parents[index] = index;
  sizes[index] = 1;
}

for (let index = 0; index < indices.length; index += 3) {
  union(indices[index], indices[index + 1]);
  union(indices[index + 1], indices[index + 2]);
}

let movedVertices = 0;
for (let index = 0; index < parents.length; index += 1) {
  if (find(index) !== targetRoot) continue;
  const offset = positionOffset + index * positionStride;
  for (let axis = 0; axis < 3; axis += 1) {
    bytes.writeFloatLE(bytes.readFloatLE(offset + axis * 4) + delta[axis], offset + axis * 4);
  }
  movedVertices += 1;
}

if (movedVertices === 0) {
  throw new Error('No vertices found for component root ' + targetRoot);
}

writeFileSync(output, bytes);
process.stdout.write(
  JSON.stringify({ input, output, targetRoot, movedVertices, delta }, null, 2) + '\n'
);

function readAccessor(index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const offset = binStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || 4;
  const values = new Uint32Array(accessor.count);
  for (let item = 0; item < accessor.count; item += 1) {
    values[item] = bytes.readUInt32LE(offset + item * stride);
  }
  return values;
}

function find(value) {
  let current = value;
  while (parents[current] !== current) {
    parents[current] = parents[parents[current]];
    current = parents[current];
  }
  return current;
}

function union(left, right) {
  let leftRoot = find(left);
  let rightRoot = find(right);
  if (leftRoot === rightRoot) return;
  if (sizes[leftRoot] < sizes[rightRoot]) {
    const swap = leftRoot;
    leftRoot = rightRoot;
    rightRoot = swap;
  }
  parents[rightRoot] = leftRoot;
  sizes[leftRoot] += sizes[rightRoot];
}
