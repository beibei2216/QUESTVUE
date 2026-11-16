import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] || 'public/models/island-house.glb');
const bytes = readFileSync(file);
const jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
const binStart = 20 + jsonLength + 8;
const primitive = json.meshes[0].primitives[0];
const positions = readAccessor(primitive.attributes.POSITION);
const indices = readAccessor(primitive.indices);
const parents = new Uint32Array(positions.length / 3);
const sizes = new Uint32Array(parents.length);

for (let index = 0; index < parents.length; index += 1) parents[index] = index;
for (let index = 0; index < sizes.length; index += 1) sizes[index] = 1;

for (let index = 0; index < indices.length; index += 3) {
  union(indices[index], indices[index + 1]);
  union(indices[index + 1], indices[index + 2]);
}

const components = new Map();
for (let index = 0; index < parents.length; index += 1) {
  const root = find(index);
  let component = components.get(root);
  if (!component) {
    component = {
      root,
      vertices: 0,
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity]
    };
    components.set(root, component);
  }
  component.vertices += 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const value = positions[index * 3 + axis];
    component.min[axis] = Math.min(component.min[axis], value);
    component.max[axis] = Math.max(component.max[axis], value);
  }
}

const limit = Number.parseInt(process.argv[3] || '80', 10);
const output = Array.from(components.values())
  .sort((a, b) => b.vertices - a.vertices)
  .slice(0, limit)
  .map((component) => ({
    root: component.root,
    vertices: component.vertices,
    center: component.min.map((value, axis) => (value + component.max[axis]) / 2),
    size: component.min.map((value, axis) => component.max[axis] - value),
    min: component.min,
    max: component.max
  }));

process.stdout.write(
  JSON.stringify(
    {
      file,
      vertexCount: parents.length,
      triangleCount: indices.length / 3,
      componentCount: components.size,
      components: output
    },
    null,
    2
  ) + '\n'
);

function readAccessor(index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const componentsByType = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const count = accessor.count * componentsByType[accessor.type];
  const offset = binStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const read =
    accessor.componentType === 5126
      ? (position) => bytes.readFloatLE(position)
      : accessor.componentType === 5125
        ? (position) => bytes.readUInt32LE(position)
        : null;
  if (!read) throw new Error('Unsupported accessor component type: ' + accessor.componentType);
  const values = new Float64Array(count);
  const stride = view.byteStride || componentsByType[accessor.type] * (accessor.componentType === 5126 ? 4 : 4);
  for (let item = 0; item < accessor.count; item += 1) {
    for (let part = 0; part < componentsByType[accessor.type]; part += 1) {
      values[item * componentsByType[accessor.type] + part] = read(offset + item * stride + part * 4);
    }
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
