import type { SheetState } from "./boardMotion.ts";

/**
 * The most sheets that one pattern has (`SHEET_COUNTS`). The shader loops to
 * this number and stops at the count of the pattern.
 */
export const MAX_SHEETS = 8;

// One triangle that covers the canvas, from the number of the vertex alone.
// Thus, there is no buffer.
const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/*
 * Each pixel samples each sheet of the pattern at its own offset, and adds its
 * mark as the stylesheet layers the sheets: each over the others, so that two
 * marks where they cross are not stronger than one.
 * The output is the ink, premultiplied by how much of the pixel the marks
 * cover. The opacity of the pattern is the CSS opacity of the canvas.
 */
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uSheets;
uniform int uCount;
uniform vec2 uTile;
uniform float uScale;
uniform float uHeight;
uniform vec2 uOffset[${MAX_SHEETS}];
uniform float uAlpha[${MAX_SHEETS}];
uniform vec3 uInk;
out vec4 color;

void main() {
  vec2 pos = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) / uScale;
  float clear = 1.0;
  for (int i = 0; i < ${MAX_SHEETS}; i++) {
    if (i >= uCount) break;
    float mark = texture(uSheets, vec3((pos - uOffset[i]) / uTile, float(i))).a;
    clear *= 1.0 - mark * uAlpha[i];
  }
  float cover = 1.0 - clear;
  color = vec4(uInk * cover, cover);
}`;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("no shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader did not compile");
  }
  return shader;
}

/** The sheets of one pattern, as the painter keeps them. */
export interface SheetTiles {
  /** The tile in CSS px. */
  width: number;
  height: number;
  /** One image for each sheet, all of one size, in device px. */
  layers: ImageBitmap[];
}

/**
 * The WebGL side of the board painter. It runs in the worker, on the canvas
 * that the board gave it. It throws if WebGL 2 is not there, and the board then
 * moves its pattern with CSS.
 */
export class BoardGl {
  private readonly gl: WebGL2RenderingContext;
  private readonly at: Record<string, WebGLUniformLocation | null> = {};
  private texture: WebGLTexture | null = null;
  private count = 0;
  private tile: readonly [number, number] = [1, 1];
  private readonly offsets = new Float32Array(MAX_SHEETS * 2);
  private readonly alphas = new Float32Array(MAX_SHEETS);

  constructor(private readonly canvas: OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) throw new Error("no WebGL 2");
    this.gl = gl;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "program did not link");
    }
    gl.useProgram(program);
    for (const name of [
      "uSheets",
      "uCount",
      "uTile",
      "uScale",
      "uHeight",
      "uOffset",
      "uAlpha",
      "uInk",
    ]) {
      this.at[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform1i(this.at.uSheets ?? null, 0);
    gl.bindVertexArray(gl.createVertexArray());
  }

  /** Puts the sheets of a new pattern in place of the old ones. */
  setSheets({ width, height, layers }: SheetTiles) {
    const { gl } = this;
    const [first] = layers;
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = null;
    this.count = 0;
    if (!first) return;
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      1,
      gl.RGBA8,
      first.width,
      first.height,
      layers.length,
    );
    for (const [i, layer] of layers.entries()) {
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        i,
        layer.width,
        layer.height,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        layer,
      );
      layer.close();
    }
    for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) {
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, wrap, gl.REPEAT);
    }
    for (const filter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, filter, gl.LINEAR);
    }
    this.texture = texture;
    this.count = Math.min(layers.length, MAX_SHEETS);
    this.tile = [width, height];
  }

  /** Sizes the canvas to the board: `width` by `height` CSS px at `scale`. */
  setSize(width: number, height: number, scale: number) {
    this.canvas.width = Math.max(1, Math.round(width * scale));
    this.canvas.height = Math.max(1, Math.round(height * scale));
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.uniform1f(this.at.uScale ?? null, scale);
    this.gl.uniform1f(this.at.uHeight ?? null, this.canvas.height);
  }

  setInk([r, g, b]: readonly [number, number, number]) {
    this.gl.uniform3f(this.at.uInk ?? null, r, g, b);
  }

  /** Draws one frame: each sheet as `states` puts it. */
  draw(states: readonly SheetState[]): void {
    const { gl, at } = this;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.texture || this.count === 0) return;
    const [tileX, tileY] = this.tile;
    for (const [i, state] of states.slice(0, this.count).entries()) {
      // Within one tile. Thus, the shader keeps its precision.
      this.offsets[2 * i] = state.x % tileX;
      this.offsets[2 * i + 1] = state.y % tileY;
      this.alphas[i] = state.alpha;
    }
    gl.uniform1i(at.uCount ?? null, this.count);
    gl.uniform2f(at.uTile ?? null, tileX, tileY);
    gl.uniform2fv(at.uOffset ?? null, this.offsets);
    gl.uniform1fv(at.uAlpha ?? null, this.alphas);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  isLost(): boolean {
    return this.gl.isContextLost();
  }
}
