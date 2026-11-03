import {
  ROLL_REPEAT_BOARDS,
  type RollWay,
  rollLine,
  type SheetState,
} from "./boardMotion.ts";

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
 * marks where they cross are not stronger than one. The marks have the opacity
 * of the pattern.
 *
 * With the gradient rolling (`uRoll`), the pixel first gets its color: its
 * place along the gradient line, less the move, in a repeat that goes to the
 * second color and back (`rollMix` in boardMotion.ts). A small dither keeps a
 * long, slow fade from showing bands. The marks go over it, and the canvas is
 * opaque. Without it, the output is the ink, premultiplied by how much of the
 * pixel the marks cover.
 */
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uSheets;
uniform int uCount;
uniform vec2 uTile;
uniform float uScale;
uniform float uHeight;
uniform vec2 uSize;
uniform vec2 uOffset[${MAX_SHEETS}];
uniform float uAlpha[${MAX_SHEETS}];
uniform vec3 uInk;
uniform float uOpacity;
uniform bool uRoll;
uniform vec3 uFrom;
uniform vec3 uTo;
uniform vec2 uDir;
uniform float uLine;
uniform float uShift;
uniform float uRepeat;
out vec4 color;

void main() {
  vec2 pos = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) / uScale;
  float clear = 1.0;
  for (int i = 0; i < ${MAX_SHEETS}; i++) {
    if (i >= uCount) break;
    float mark = texture(uSheets, vec3((pos - uOffset[i]) / uTile, float(i))).a;
    clear *= 1.0 - mark * uAlpha[i];
  }
  float cover = (1.0 - clear) * uOpacity;
  if (!uRoll) {
    color = vec4(uInk * cover, cover);
    return;
  }
  float along = dot(pos - uSize * 0.5, uDir) / uLine + 0.5;
  float q = fract((along - uShift) / uRepeat);
  vec3 ground = mix(uFrom, uTo, 1.0 - abs(2.0 * q - 1.0));
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  ground += (noise - 0.5) / 255.0;
  color = vec4(mix(ground, uInk, cover), 1.0);
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

/** The rolling gradient: its two colors, from 0 to 1, and where it goes. */
export interface RollColors {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  way: RollWay;
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
  private size: readonly [number, number] = [1, 1];
  private way: RollWay | null = null;
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
      "uSize",
      "uOffset",
      "uAlpha",
      "uInk",
      "uOpacity",
      "uRoll",
      "uFrom",
      "uTo",
      "uDir",
      "uLine",
      "uShift",
      "uRepeat",
    ]) {
      this.at[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform1i(this.at.uSheets ?? null, 0);
    gl.uniform1f(this.at.uRepeat ?? null, ROLL_REPEAT_BOARDS);
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
    this.gl.uniform2f(this.at.uSize ?? null, width, height);
    this.size = [width, height];
    this.placeRoll();
  }

  /** The opacity of the marks of the pattern, from 0 to 1. */
  setOpacity(opacity: number) {
    this.gl.uniform1f(this.at.uOpacity ?? null, opacity);
  }

  /** The rolling gradient, or null for a canvas with only the pattern. */
  setRoll(roll: RollColors | null) {
    const { gl, at } = this;
    gl.uniform1i(at.uRoll ?? null, roll ? 1 : 0);
    this.way = roll?.way ?? null;
    if (!roll) return;
    gl.uniform3f(at.uFrom ?? null, ...roll.from);
    gl.uniform3f(at.uTo ?? null, ...roll.to);
    this.placeRoll();
  }

  /** The gradient line, which follows the shape of the board. */
  private placeRoll() {
    if (!this.way) return;
    const [width, height] = this.size;
    const { dir, length } = rollLine(this.way, width, height);
    this.gl.uniform2f(this.at.uDir ?? null, dir[0], dir[1]);
    this.gl.uniform1f(this.at.uLine ?? null, length);
  }

  setInk([r, g, b]: readonly [number, number, number]) {
    this.gl.uniform3f(this.at.uInk ?? null, r, g, b);
  }

  /**
   * Draws one frame: each sheet as `states` puts it, over the gradient moved
   * by `shift` boards along its line (`rollShift` in boardMotion.ts).
   */
  draw(states: readonly SheetState[], shift: number): void {
    const { gl, at } = this;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const count = this.texture ? Math.min(this.count, states.length) : 0;
    if (count === 0 && !this.way) return;
    const [tileX, tileY] = this.tile;
    for (const [i, state] of states.slice(0, count).entries()) {
      // Within one tile. Thus, the shader keeps its precision.
      this.offsets[2 * i] = state.x % tileX;
      this.offsets[2 * i + 1] = state.y % tileY;
      this.alphas[i] = state.alpha;
    }
    gl.uniform1i(at.uCount ?? null, count);
    gl.uniform2f(at.uTile ?? null, tileX, tileY);
    gl.uniform2fv(at.uOffset ?? null, this.offsets);
    gl.uniform1fv(at.uAlpha ?? null, this.alphas);
    gl.uniform1f(at.uShift ?? null, shift);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  isLost(): boolean {
    return this.gl.isContextLost();
  }
}
