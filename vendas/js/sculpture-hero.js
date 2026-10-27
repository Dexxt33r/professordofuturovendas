/* ============================================
   PROFESSOR DO FUTURO — SITE DE VENDAS
   sculpture-hero.js
   ---------------
   Escultura líquida do hero: "Sculpture Hero"
   (original: guglielmogiannattasio.it), portada de React/shadcn
   para JS puro — este site não usa build nem framework.

   ~100 mil partículas simuladas na GPU (WebGL2 GPGPU) amostradas
   a partir de uma imagem nossa (capelo + wordmark desenhados em
   canvas com fundo transparente). O cursor "derrete" o material;
   ele volta e se reorganiza sozinho. Sem WebGL2, a imagem estática
   é exibida. Sem dependências externas.

   Uso: <div class="sculpt-stage" data-sculpture>…</div> + este JS.
   ============================================ */
(function () {
  'use strict';

  /* ---------- utilitários ---------- */

  function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
  }

  function hexToRgb(hex, fallback) {
    if (typeof hex !== 'string') return fallback;
    var s = hex.trim();
    var m = s.match(/^#?([0-9a-f]{3})$/i);
    if (m) {
      var tri = m[1].split('').map(function (c) { return parseInt(c + c, 16) / 255; });
      return [tri[0], tri[1], tri[2]];
    }
    m = s.match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (m) {
      var n = parseInt(m[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
    return fallback;
  }

  /* ---------- shaders ---------- */

  var NOISE = [
    'float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }',
    'float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0);',
    '  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x), mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x), u.y); }',
    'vec2 ambientField(vec2 uv, float t){',
    '  vec2 q = uv*vec2(3.2,1.7);',
    '  vec2 a = vec2(vnoise(q+vec2(t*0.11,0.0))-0.5, vnoise(q+vec2(5.2,t*0.08)+3.1)-0.5);',
    '  vec2 q2 = uv*vec2(7.5,4.0) + vec2(-t*0.19, t*0.13);',
    '  vec2 b = vec2(vnoise(q2+1.7)-0.5, vnoise(q2+9.3)-0.5);',
    '  return a + b*0.45;',
    '}'
  ].join('\n');

  /* energia do material num ponto: compartilhada pela imagem e pelas
     partículas para o cross-fade ser exatamente complementar */
  var ENERGY = [
    'float energyAt(vec2 rectPx, vec2 mouse, float radius, float presence, float wakeEnergy){',
    '  vec2 d = rectPx - mouse;',
    '  float f = exp(-dot(d,d)/(radius*radius))*presence;',
    '  return smoothstep(0.06, 0.5, f*1.15 + wakeEnergy*1.7);',
    '}'
  ].join('\n');

  var QUAD_VS = '#version 300 es\n' +
    'layout(location=0) in vec2 aPos;\n' +
    'out vec2 vUv;\n' +
    'void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }\n';

  /* Flow map (rastro do cursor). RGBA8: velocidade codificada em torno
     de 128, energia em B. */
  var FLOW_FS = '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec2 vUv;\n' +
    'out vec4 o;\n' +
    'uniform sampler2D uPrev;\n' +
    'uniform vec2 uTexel;\n' +
    'uniform vec2 uMouse;\n' +
    'uniform vec2 uVel;\n' +
    'uniform vec2 uSize;\n' +
    'uniform float uRadius;\n' +
    'uniform float uPresence;\n' +
    'uniform float uDecay;\n' +
    'vec2 decV(vec4 c){ return (c.rg*255.0-128.0)/127.0; }\n' +
    'void main(){\n' +
    '  vec2 v0 = decV(texture(uPrev, vUv));\n' +
    '  vec2 uv = vUv - v0*uTexel*2.5;\n' +
    '  vec4 c = texture(uPrev, uv)*0.52\n' +
    '    + 0.12*(texture(uPrev, uv+vec2(uTexel.x,0.0)) + texture(uPrev, uv-vec2(uTexel.x,0.0))\n' +
    '          + texture(uPrev, uv+vec2(0.0,uTexel.y)) + texture(uPrev, uv-vec2(0.0,uTexel.y)));\n' +
    '  vec2 v = decV(c);\n' +
    '  float p = c.b;\n' +
    '  vec2 d = (vUv-uMouse)*uSize;\n' +
    '  float f = exp(-dot(d,d)/(uRadius*uRadius))*uPresence;\n' +
    '  float sp = clamp(length(uVel)*2.5, 0.0, 1.0);\n' +
    '  v += uVel*f*0.22;\n' +
    '  p = max(p, f*sp);\n' +
    '  v *= uDecay;\n' +
    '  p *= uDecay;\n' +
    '  v = sign(v)*max(abs(v)-1.2/127.0, 0.0);\n' +
    '  p = max(p-1.2/255.0, 0.0);\n' +
    '  v = clamp(v, -1.0, 1.0);\n' +
    '  o = vec4((v*127.0+128.0)/255.0, p, 1.0);\n' +
    '}\n';

  /* Passo GPGPU: estado = (offset.xy, velocity.xy) em px CSS do retângulo. */
  var SIM_FS = '#version 300 es\n' +
    'precision highp float;\n' +
    'out vec4 o;\n' +
    'uniform sampler2D uState;\n' +
    'uniform sampler2D uHome;\n' +
    'uniform sampler2D uFlow;\n' +
    'uniform vec2 uSize;\n' +
    'uniform vec2 uMouse;\n' +
    'uniform float uRadius;\n' +
    'uniform float uPresence;\n' +
    'uniform float uStrength;\n' +
    'uniform float uSpread;\n' +
    'uniform float uTurb;\n' +
    'uniform float uReturn;\n' +
    'uniform float uTime;\n' +
    'uniform float uDt;\n' +
    'uniform float uIntro;\n' +
    NOISE + '\n' +
    'vec2 curl(vec2 p){\n' +
    '  const float e = 0.35;\n' +
    '  float a = vnoise(p+vec2(0.0,e)) - vnoise(p-vec2(0.0,e));\n' +
    '  float b = vnoise(p+vec2(e,0.0)) - vnoise(p-vec2(e,0.0));\n' +
    '  return vec2(a, -b)/(2.0*e);\n' +
    '}\n' +
    'void main(){\n' +
    '  ivec2 ij = ivec2(gl_FragCoord.xy);\n' +
    '  vec4 hm = texelFetch(uHome, ij, 0);\n' +
    '  if(hm.w <= 0.0){ o = vec4(0.0); return; }\n' +
    '  vec4 st = texelFetch(uState, ij, 0);\n' +
    '  vec2 off = st.xy;\n' +
    '  vec2 vel = st.zw;\n' +
    '  float sd = hm.z;\n' +
    '  float light = 0.45 + sd*1.1;\n' +
    '\n' +
    '  vec2 p = hm.xy*uSize + off;\n' +
    '  vec4 fl = texture(uFlow, clamp(p/uSize, 0.0, 1.0));\n' +
    '  vec2 wake = (fl.rg*255.0-128.0)/127.0;\n' +
    '  float pr = fl.b;\n' +
    '\n' +
    '  vec2 toM = p - uMouse;\n' +
    '  float r2 = dot(toM,toM);\n' +
    '  float f = exp(-r2/(uRadius*uRadius))*uPresence;\n' +
    '  vec2 n = toM*inversesqrt(r2+1.0);\n' +
    '  float e = clamp(pr*2.0 + f, 0.0, 1.0);\n' +
    '\n' +
    '  vec2 acc = vec2(0.0);\n' +
    '  // soprado para fora e girado ao redor do cursor\n' +
    '  acc += n*f*1.25*uStrength*uSpread*light;\n' +
    '  acc += vec2(-n.y, n.x)*f*1.45*uStrength*uSpread*(0.4+sd);\n' +
    '  // carreado pelo rastro líquido\n' +
    '  acc += (wake*42.0*uSpread*light - vel)*e*0.08;\n' +
    '  // turbulência curl-noise onde o material está agitado (e na intro)\n' +
    '  vec2 q = p*0.0095 + vec2(uTime*0.35, -uTime*0.2);\n' +
    '  vec2 c = curl(q) + 0.5*curl(q*2.3 + 7.1);\n' +
    '  acc += c*(e*1.2*uSpread + uIntro*1.5)*uTurb*light;\n' +
    '  // retorno elástico para casa\n' +
    '  float k = (0.006 + 0.02*uReturn)*(0.65+sd*0.7)*(1.0 - uIntro*0.75);\n' +
    '  acc -= off*k;\n' +
    '\n' +
    '  vel += acc*uDt;\n' +
    '  vel *= pow(mix(0.93, 0.955, e), uDt);\n' +
    '  off += vel*uDt;\n' +
    '  if(dot(off,off) < 0.0004 && dot(vel,vel) < 0.0004){ off = vec2(0.0); vel = vec2(0.0); }\n' +
    '  o = vec4(off, vel);\n' +
    '}\n';

  /* Partículas: um quad instanciado por partícula, cápsula esticada
     ao longo da velocidade. */
  var PART_VS = '#version 300 es\n' +
    'precision highp float;\n' +
    'layout(location=0) in vec2 aCorner;\n' +
    'uniform sampler2D uState;\n' +
    'uniform sampler2D uHome;\n' +
    'uniform sampler2D uCol;\n' +
    'uniform sampler2D uFlow;\n' +
    'uniform int uTexW;\n' +
    'uniform vec4 uRect;\n' +
    'uniform vec2 uRes;\n' +
    'uniform vec2 uMouse;\n' +
    'uniform float uRadius;\n' +
    'uniform float uPresence;\n' +
    'uniform float uDot;\n' +
    'uniform float uTime;\n' +
    'uniform float uAmbient;\n' +
    'uniform float uStreak;\n' +
    'uniform float uIntroVis;\n' +
    'uniform float uRest;\n' +
    'uniform vec3 uTint;\n' +
    'out vec2 vLocal;\n' +
    'out float vHalfLen;\n' +
    'out float vR;\n' +
    'out vec3 vCol;\n' +
    'out float vA;\n' +
    NOISE + '\n' +
    ENERGY + '\n' +
    'void main(){\n' +
    '  int id = gl_InstanceID;\n' +
    '  ivec2 ij = ivec2(id % uTexW, id / uTexW);\n' +
    '  vec4 hm = texelFetch(uHome, ij, 0);\n' +
    '  vec4 st = texelFetch(uState, ij, 0);\n' +
    '  vec4 cl = texelFetch(uCol, ij, 0);\n' +
    '\n' +
    '  float wakeE = texture(uFlow, hm.xy).b;\n' +
    '  float E = energyAt(hm.xy*uRect.zw, uMouse, uRadius, uPresence, wakeE);\n' +
    '  float lift = smoothstep(0.35, 2.5, length(st.xy));\n' +
    '  float a = max(max(E, lift), max(uRest, 1.0-uIntroVis));\n' +
    '  if(a < 0.01 || hm.w <= 0.0){ gl_Position = vec4(2.0,2.0,2.0,1.0); return; }\n' +
    '\n' +
    '  vec2 base = uRect.xy + hm.xy*uRect.zw + st.xy;\n' +
    '  base -= ambientField(hm.xy, uTime)*10.0*uAmbient;\n' +
    '\n' +
    '  vec2 v = st.zw;\n' +
    '  float sp = length(v);\n' +
    '  vec2 dir = sp > 0.001 ? v/sp : vec2(1.0,0.0);\n' +
    '  float r = uDot*hm.w*0.5;\n' +
    '  float len = min(sp*1.25, 18.0)*uStreak;\n' +
    '  vec2 lc = aCorner*vec2(r + len*0.5 + 1.0, r + 1.0);\n' +
    '  vec2 center = base - dir*len*0.5;\n' +
    '  vec2 world = center + dir*lc.x + vec2(-dir.y, dir.x)*lc.y;\n' +
    '\n' +
    '  vec2 clip = world/uRes*2.0-1.0;\n' +
    '  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);\n' +
    '  vLocal = lc;\n' +
    '  vHalfLen = len*0.5;\n' +
    '  vR = r;\n' +
    '  vec3 col = cl.rgb*uTint;\n' +
    '  // material rápido pega a luz, como metal líquido\n' +
    '  float glint = smoothstep(2.0, 16.0, sp);\n' +
    '  col = mix(col, min(col*1.18 + vec3(0.07,0.075,0.085), vec3(1.0)), glint*0.75);\n' +
    '  vCol = col;\n' +
    '  vA = a;\n' +
    '}\n';

  var PART_FS = '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec2 vLocal;\n' +
    'in float vHalfLen;\n' +
    'in float vR;\n' +
    'in vec3 vCol;\n' +
    'in float vA;\n' +
    'uniform float uDpr;\n' +
    'out vec4 o;\n' +
    'void main(){\n' +
    '  vec2 q = vec2(max(abs(vLocal.x)-vHalfLen, 0.0), vLocal.y);\n' +
    '  float d = length(q) - vR;\n' +
    '  float a = clamp(0.5 - d*uDpr, 0.0, 1.0);\n' +
    '  // cauda de cometa: a ponta de trás afina\n' +
    '  float tail = vHalfLen > 0.0 ? clamp(0.5 - vLocal.x/(2.0*(vHalfLen+vR)), 0.0, 1.0) : 0.0;\n' +
    '  a *= 1.0 - tail*0.55;\n' +
    '  a *= vA;\n' +
    '  if(a < 0.004) discard;\n' +
    '  o = vec4(vCol*a, a);\n' +
    '}\n';

  /* Passagem da imagem: a escultura nítida, com leve lente, somando
     onde o material ainda está sólido. */
  var IMAGE_FS = '#version 300 es\n' +
    'precision highp float;\n' +
    'out vec4 o;\n' +
    'uniform sampler2D uImg;\n' +
    'uniform sampler2D uFlow;\n' +
    'uniform vec2 uRes;\n' +
    'uniform float uDpr;\n' +
    'uniform vec4 uRect;\n' +
    'uniform vec3 uBg;\n' +
    'uniform vec3 uImgBg;\n' +
    'uniform vec2 uMouse;\n' +
    'uniform float uPresence;\n' +
    'uniform float uRadius;\n' +
    'uniform float uStrength;\n' +
    'uniform float uTime;\n' +
    'uniform float uAmbient;\n' +
    'uniform float uIntroVis;\n' +
    'uniform float uRest;\n' +
    'uniform float uAlphaMode;\n' +
    NOISE + '\n' +
    ENERGY + '\n' +
    'void main(){\n' +
    '  vec2 px = vec2(gl_FragCoord.x, uRes.y*uDpr - gl_FragCoord.y)/uDpr;\n' +
    '  vec2 size = uRect.zw;\n' +
    '  vec2 uv = (px-uRect.xy)/size;\n' +
    '  if(uv.x < -0.05 || uv.x > 1.05 || uv.y < -0.12 || uv.y > 1.12){ o = vec4(0.0); return; }\n' +
    '  vec4 fl = texture(uFlow, clamp(uv,0.0,1.0));\n' +
    '  vec2 vel = (fl.rg*255.0-128.0)/127.0;\n' +
    '  vec2 rp = uv*size;\n' +
    '  vec2 toM = rp - uMouse;\n' +
    '  float fall = exp(-dot(toM,toM)/(uRadius*uRadius))*uPresence;\n' +
    '  vec2 disp = -toM*0.22*uStrength*fall - vel*10.0*uStrength;\n' +
    '  disp += ambientField(uv, uTime)*10.0*uAmbient;\n' +
    '  vec2 suv = uv + disp/size;\n' +
    '  vec4 tx = texture(uImg, suv);\n' +
    '  vec3 col = tx.rgb;\n' +
    '  vec2 e = smoothstep(vec2(0.0), vec2(0.004,0.01), suv) * smoothstep(vec2(1.0), vec2(0.996,0.99), suv);\n' +
    '  // imagens recortadas carregam a própria alpha; as de fundo plano são cortadas por cor\n' +
    '  float key = uAlphaMode > 0.5 ? tx.a : smoothstep(0.012, 0.05, length(col-uImgBg));\n' +
    '  float k = key*e.x*e.y;\n' +
    '  float E = energyAt(rp, uMouse, uRadius, uPresence, fl.b);\n' +
    '  float show = (1.0 - max(E, uRest))*uIntroVis;\n' +
    '  vec3 mat = uAlphaMode > 0.5 ? col : col*(uBg/max(uImgBg, vec3(0.001)));\n' +
    '  // alpha pré-multiplicada: os vazios ficam transparentes e a página aparece atrás\n' +
    '  float A = k*show;\n' +
    '  o = vec4(mat*A, A);\n' +
    '}\n';

  /* ---------- helpers ---------- */

  function compile(gl, vs, fs) {
    var make = function (type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error('Shader: ' + log);
      }
      return sh;
    };
    var p = gl.createProgram();
    var v = make(gl.VERTEX_SHADER, vs);
    var f = make(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    var u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      if (info) u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  /* ---------- engine (WebGL2 GPGPU de partículas) ---------- */

  var TEX_W = 1024;
  var SETTLE_FRAMES = 270;

  function LiquidEngine(canvas, opts, onFail) {
    this.lastImage = null;
    this.onFirstFrame = null; // chamada 1x, após o 1º frame de verdade
    this.canvas = canvas;
    this.opts = opts;
    this.onFail = onFail;
    this.lowPower = false;
    this.stateFormat = { internal: 0, type: 0 };
    this.pFlow = null; this.pSim = null; this.pPart = null; this.pImg = null;
    this.vao = null; this.quad = null;
    this.imgTex = null;
    this.flowTex = []; this.flowFb = [];
    this.flowW = 256; this.flowH = 104; this.flowIdx = 0; this.flowDirty = false;
    this.homeTex = null; this.colTex = null;
    this.stateTex = []; this.stateFb = []; this.stateIdx = 0;
    this.texH = 1; this.n = 0; this.gridW = 1; this.stateDirty = false;
    this.alphaMode = false;
    this.imgBg = [0.918, 0.914, 0.906];
    this.flowing = 0;
    this.aspect = 2.5;
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.cssW = 1; this.cssH = 1;
    this.target = { x: -9999, y: -9999 };
    this.mouse = { x: -9999, y: -9999 };
    this.prevMouse = { x: -9999, y: -9999 };
    this.mvel = { x: 0, y: 0 };
    this.presence = 0; this.presenceTarget = 0;
    this.burst = 0;
    this.lastInput = -1e9;
    this.settle = 1e9;
    this.touchRelease = 0;
    this.time = 0; this.introT = 1;
    this.raf = 0; this.running = false; this.last = 0; this.skip = 0;
    this.visible = true; this.ready = false; this.destroyed = false; this.lost = false;
    this.homeData = null;

    // alpha: um canvas não apresentado fica transparente, então a imagem
    // estática por baixo aparece
    var gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('WebGL2 indisponível');
    this.gl = gl;
    var nav = navigator;
    this.lowPower =
      (nav.hardwareConcurrency || 8) <= 4 ||
      (nav.deviceMemory || 8) <= 4 ||
      window.matchMedia('(pointer: coarse)').matches;
    this.initGL();
    var self = this;
    canvas.addEventListener('webglcontextlost', function (e) { self.onLost(e); }, false);
  }

  LiquidEngine.prototype.onLost = function (e) {
    e.preventDefault();
    this.lost = true;
    this.stop();
    this.onFail();
  };

  LiquidEngine.prototype.initGL = function () {
    var gl = this.gl;
    // render targets de float: RGBA16F basta (offsets em px, precisão subpixel)
    var full = gl.getExtension('EXT_color_buffer_float');
    var half = full ? null : gl.getExtension('EXT_color_buffer_half_float');
    if (!full && !half) throw new Error('Sem render targets de float');
    this.stateFormat = { internal: gl.RGBA16F, type: gl.HALF_FLOAT };

    this.pFlow = compile(gl, QUAD_VS, FLOW_FS);
    this.pSim = compile(gl, QUAD_VS, SIM_FS);
    this.pPart = compile(gl, PART_VS, PART_FS);
    this.pImg = compile(gl, QUAD_VS, IMAGE_FS);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    for (var i = 0; i < 2; i++) {
      var t = this.makeTex(gl.RGBA8, this.flowW, this.flowH, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      this.flowTex.push(t);
      this.flowFb.push(fb);
    }
    this.clearFlow();
  };

  LiquidEngine.prototype.makeTex = function (internal, w, h, format, type, data, filter) {
    var gl = this.gl;
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };

  LiquidEngine.prototype.clearFlow = function () {
    var gl = this.gl;
    for (var i = 0; i < this.flowFb.length; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.flowFb[i]);
      gl.viewport(0, 0, this.flowW, this.flowH);
      gl.clearColor(128 / 255, 128 / 255, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.flowDirty = false;
  };

  LiquidEngine.prototype.clearState = function () {
    var gl = this.gl;
    for (var i = 0; i < this.stateFb.length; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFb[i]);
      gl.viewport(0, 0, TEX_W, this.texH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.stateDirty = false;
  };

  LiquidEngine.prototype.setImage = function (img) {
    if (this.destroyed || this.lost) return;
    var gl = this.gl;
    this.lastImage = img;
    this.aspect = img.naturalWidth / img.naturalHeight || 2.5;
    this.flowH = Math.max(32, Math.round(this.flowW / this.aspect));
    for (var i = 0; i < this.flowTex.length; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.flowTex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.flowW, this.flowH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    this.clearFlow();
    if (this.imgTex) gl.deleteTexture(this.imgTex);
    this.imgTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.buildParticles(img);
    this.ready = true;
    if (this.opts.intro && !this.opts.reducedMotion) this.startIntro();
    this.wake();
  };

  /* Uma partícula por pixel de material numa grade lançada sobre a imagem. */
  LiquidEngine.prototype.buildParticles = function (img) {
    var gl = this.gl;
    var baseGrid = this.lowPower ? 640 : 1000;
    var gw = Math.round(baseGrid * Math.sqrt(clamp(this.opts.density, 0.15, 2)));
    var gh = Math.max(1, Math.round(gw / this.aspect));
    this.gridW = gw;
    var data;
    try {
      var c = document.createElement('canvas');
      c.width = gw;
      c.height = gh;
      var ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, gw, gh);
      data = ctx.getImageData(0, 0, gw, gh).data;
    } catch (err) {
      throw new Error('Imagem ilegível para canvas');
    }
    // um recorte (com transparência) é amostrado por alpha; um de fundo
    // plano, por distância de cor
    var transparent = 0;
    for (var t = 3; t < data.length; t += 4 * 7) if (data[t] < 250) transparent++;
    this.alphaMode = transparent > data.length / (4 * 7) / 20;
    if (this.opts.imgBg) this.imgBg = this.opts.imgBg;
    else if (!this.alphaMode) {
      // fundo plano: média dos quatro cantos
      var r = 0, g = 0, b = 0, n = 0;
      var pw = Math.max(2, Math.round(gw * 0.012));
      var cantos = [[0, 0], [gw - pw, 0], [0, gh - pw], [gw - pw, gh - pw]];
      for (var ci = 0; ci < cantos.length; ci++) {
        for (var y = cantos[ci][1]; y < cantos[ci][1] + pw; y++)
          for (var x = cantos[ci][0]; x < cantos[ci][0] + pw; x++) {
            var ii = (y * gw + x) * 4;
            r += data[ii]; g += data[ii + 1]; b += data[ii + 2]; n++;
          }
      }
      this.imgBg = [r / n / 255, g / n / 255, b / n / 255];
    }
    var home = [];
    var col = [];
    for (var yy = 0; yy < gh; yy++) {
      for (var xx = 0; xx < gw; xx++) {
        var j = (yy * gw + xx) * 4;
        var pr = data[j] / 255;
        var pg = data[j + 1] / 255;
        var pb = data[j + 2] / 255;
        if (this.alphaMode) {
          var a = data[j + 3] / 255;
          if (a < 0.12) continue;
          if (a < 0.5 && Math.random() > a * 2) continue;
        } else {
          var dev = Math.hypot(pr - this.imgBg[0], pg - this.imgBg[1], pb - this.imgBg[2]);
          if (dev < 0.03) continue;
          if (dev < 0.07 && Math.random() > (dev - 0.03) / 0.04) continue;
        }
        var jx = (Math.random() - 0.5) * 0.6;
        var jy = (Math.random() - 0.5) * 0.6;
        home.push((xx + 0.5 + jx) / gw, (yy + 0.5 + jy) / gh, Math.random(), 0.85 + Math.random() * 0.3);
        col.push(data[j], data[j + 1], data[j + 2], 255);
      }
    }
    var count = home.length / 4;
    this.n = count;
    this.texH = Math.max(1, Math.ceil(count / TEX_W));
    var total = TEX_W * this.texH;
    var homeArr = new Float32Array(total * 4);
    homeArr.set(home);
    var colArr = new Uint8Array(total * 4);
    colArr.set(col);

    var k;
    for (k = 0; k < this.stateTex.length; k++) gl.deleteTexture(this.stateTex[k]);
    if (this.homeTex) gl.deleteTexture(this.homeTex);
    if (this.colTex) gl.deleteTexture(this.colTex);
    for (k = 0; k < this.stateFb.length; k++) gl.deleteFramebuffer(this.stateFb[k]);
    this.stateTex = [];
    this.stateFb = [];
    this.homeTex = this.makeTex(gl.RGBA32F, TEX_W, this.texH, gl.RGBA, gl.FLOAT, homeArr, gl.NEAREST);
    this.colTex = this.makeTex(gl.RGBA8, TEX_W, this.texH, gl.RGBA, gl.UNSIGNED_BYTE, colArr, gl.NEAREST);
    for (var s = 0; s < 2; s++) {
      var st = this.makeTex(this.stateFormat.internal, TEX_W, this.texH, gl.RGBA, this.stateFormat.type, null, gl.NEAREST);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, st, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FBO float incompleto');
      this.stateTex.push(st);
      this.stateFb.push(fb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.homeData = homeArr;
    this.clearState();
  };

  LiquidEngine.prototype.startIntro = function () {
    var gl = this.gl;
    var home = this.homeData;
    if (!home) return;
    var w = this.rect.w > 10 ? this.rect.w : 1300;
    var total = TEX_W * this.texH;
    var st = new Float32Array(total * 4);
    for (var i = 0; i < this.n; i++) {
      var hx = home[i * 4] - 0.5;
      var hy = home[i * 4 + 1] - 0.5;
      var sd = home[i * 4 + 2];
      var ang = (Math.random() - 0.5) * 0.9 + (hx > 0 ? 0 : Math.PI);
      var dist = w * (0.04 + Math.random() * 0.14) * (0.5 + Math.abs(hx) * 1.4);
      st[i * 4] = Math.cos(ang) * dist + hx * w * 0.25 * sd;
      st[i * 4 + 1] = Math.sin(ang) * dist * 0.55 + hy * 120 * (Math.random() - 0.5);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex[this.stateIdx]);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.stateFormat.internal, TEX_W, this.texH, 0, gl.RGBA, gl.FLOAT, st);
    this.introT = 0;
    this.stateDirty = true;
  };

  LiquidEngine.prototype.setOptions = function (o) {
    this.opts = { ...this.opts, ...o };
    this.wake();
  };

  LiquidEngine.prototype.resize = function (cssW, cssH, rect) {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.rect = rect;
    var dpr = Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.5 : 2);
    var px = this.cssW * this.cssH * dpr * dpr;
    if (px > 4.5e6) dpr = Math.max(1, Math.sqrt(4.5e6 / (this.cssW * this.cssH)));
    var w = Math.round(this.cssW * dpr);
    var h = Math.round(this.cssH * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.draw();
  };

  LiquidEngine.prototype.setVisible = function (v) {
    this.visible = v;
    if (v) this.wake();
    else this.stop();
  };

  LiquidEngine.prototype.pointer = function (type, x, y, touch) {
    if (!this.opts.interactive || this.lost) return;
    var now = performance.now();
    if (type === 'leave' || type === 'up') {
      if (touch) this.touchRelease = now + 260;
      else this.presenceTarget = 0;
      this.wake();
      return;
    }
    if (this.mouse.x < -9000 || type === 'down') {
      this.mouse.x = this.prevMouse.x = x;
      this.mouse.y = this.prevMouse.y = y;
    }
    this.target.x = x;
    this.target.y = y;
    this.presenceTarget = 1;
    this.lastInput = now;
    this.settle = 0;
    if (type === 'down') {
      this.burst = 1;
      this.touchRelease = 0;
    }
    this.wake();
  };

  LiquidEngine.prototype.wake = function () {
    if (!this.ready || this.running || !this.visible || this.destroyed || this.lost) {
      if (this.ready && !this.running) this.draw();
      return;
    }
    this.running = true;
    this.last = performance.now();
    var self = this;
    this.raf = requestAnimationFrame(function (t) { self.frame(t); });
  };

  LiquidEngine.prototype.stop = function () {
    this.running = false;
    cancelAnimationFrame(this.raf);
  };

  LiquidEngine.prototype.radiusPx = function () {
    return this.opts.radius * clamp(this.rect.w / 1400, 0.6, 1.25);
  };

  LiquidEngine.prototype.strength = function () {
    return this.opts.strength * (this.opts.reducedMotion ? 0.5 : 1);
  };

  LiquidEngine.prototype.frame = function (now) {
    if (!this.running) return;
    var rawMs = now - this.last;
    var dt = clamp(rawMs / 16.6667, 0.25, 3);
    this.last = now;
    var o = this.opts;
    var ambientOn = o.ambient && !o.reducedMotion;

    if (this.touchRelease && now > this.touchRelease) {
      this.presenceTarget = 0;
      this.touchRelease = 0;
    }
    var ease = 1 - Math.pow(1 - 0.22, dt);
    this.mouse.x += (this.target.x - this.mouse.x) * ease;
    this.mouse.y += (this.target.y - this.mouse.y) * ease;
    var vx = (this.mouse.x - this.prevMouse.x) / dt;
    var vy = (this.mouse.y - this.prevMouse.y) / dt;
    this.prevMouse.x = this.mouse.x;
    this.prevMouse.y = this.mouse.y;
    this.mvel.x += (clamp(vx, -60, 60) - this.mvel.x) * 0.5;
    this.mvel.y += (clamp(vy, -60, 60) - this.mvel.y) * 0.5;
    var pk = this.presenceTarget > this.presence ? 0.1 : 0.035;
    this.presence += (this.presenceTarget - this.presence) * (1 - Math.pow(1 - pk, dt));
    if (this.presence < 0.001 && this.presenceTarget === 0) this.presence = 0;
    var fk = this.presenceTarget > this.flowing ? 0.05 : 0.018;
    this.flowing += (this.presenceTarget - this.flowing) * (1 - Math.pow(1 - fk, dt));
    if (this.flowing < 0.002 && this.presenceTarget === 0) this.flowing = 0;
    if (this.introT < 1) this.introT = Math.min(1, this.introT + Math.min(rawMs, 100) / 3200);

    var interacting = this.presence > 0.001 || this.burst > 0;
    // settle é contado em frames simulados: nenhum aparelho lento corta o retorno
    this.settle = interacting ? 0 : this.settle + dt;
    var active = interacting || this.settle < SETTLE_FRAMES || this.introT < 1;

    var self = this;
    if (!active) {
      if (this.flowDirty) this.clearFlow();
      if (this.stateDirty) this.clearState();
      if (!ambientOn) {
        this.draw();
        this.firstFrame();
        this.stop();
        return;
      }
      this.raf = requestAnimationFrame(function (t) { self.frame(t); });
      if (this.skip++ % 2) return;
      this.time += (dt * 2 * o.speed) / 60;
      this.draw();
      this.firstFrame();
      return;
    }
    this.raf = requestAnimationFrame(function (t) { self.frame(t); });
    // o campo acelera enquanto o material está sendo agitado
    this.time += (dt * o.speed * (1 + this.flowing * 1.6)) / 60;
    this.stepFlow(dt);
    this.stepSim(dt);
    this.burst = Math.max(0, this.burst - 0.1 * dt);
    this.draw();
    this.firstFrame();
  };

  LiquidEngine.prototype.firstFrame = function () {
    if (this.onFirstFrame) {
      var cb = this.onFirstFrame;
      this.onFirstFrame = null;
      // mais um frame para o compositor já ter apresentado o canvas
      requestAnimationFrame(function () { cb(); });
    }
  };

  LiquidEngine.prototype.stepFlow = function (dt) {
    var gl = this.gl;
    var P = this.pFlow;
    var dst = 1 - this.flowIdx;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.flowFb[dst]);
    gl.viewport(0, 0, this.flowW, this.flowH);
    gl.disable(gl.BLEND);
    gl.useProgram(P.p);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.flowTex[this.flowIdx]);
    gl.uniform1i(P.u.uPrev, 0);
    gl.uniform2f(P.u.uTexel, 1 / this.flowW, 1 / this.flowH);
    var r = this.rect;
    gl.uniform2f(P.u.uMouse, (this.mouse.x - r.x) / r.w, (this.mouse.y - r.y) / r.h);
    gl.uniform2f(P.u.uVel, clamp(this.mvel.x / 40, -1, 1), clamp(this.mvel.y / 40, -1, 1));
    gl.uniform2f(P.u.uSize, r.w, r.h);
    gl.uniform1f(P.u.uRadius, this.radiusPx());
    gl.uniform1f(P.u.uPresence, Math.max(this.presence, this.burst));
    gl.uniform1f(P.u.uDecay, Math.pow(0.968, dt));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.flowIdx = dst;
    this.flowDirty = true;
  };

  LiquidEngine.prototype.stepSim = function (dt) {
    if (!this.n) return;
    var gl = this.gl;
    var P = this.pSim;
    var o = this.opts;
    var r = this.rect;
    var dst = 1 - this.stateIdx;
    var intro = o.reducedMotion || !o.intro ? 0 : Math.pow(1 - this.introT, 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFb[dst]);
    gl.viewport(0, 0, TEX_W, this.texH);
    gl.disable(gl.BLEND);
    gl.useProgram(P.p);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex[this.stateIdx]);
    gl.uniform1i(P.u.uState, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.homeTex);
    gl.uniform1i(P.u.uHome, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.flowTex[this.flowIdx]);
    gl.uniform1i(P.u.uFlow, 2);
    gl.uniform2f(P.u.uSize, r.w, r.h);
    gl.uniform2f(P.u.uMouse, this.mouse.x - r.x, this.mouse.y - r.y);
    gl.uniform1f(P.u.uRadius, this.radiusPx());
    gl.uniform1f(P.u.uPresence, Math.max(this.presence, this.burst));
    gl.uniform1f(P.u.uStrength, this.strength() * (1 + this.burst * 1.5));
    gl.uniform1f(P.u.uSpread, clamp(o.spread, 0, 2));
    gl.uniform1f(P.u.uTurb, clamp(o.turbulence, 0, 2) * (o.reducedMotion ? 0.3 : 1));
    gl.uniform1f(P.u.uReturn, clamp(o.returnSpeed, 0, 2));
    gl.uniform1f(P.u.uTime, this.time);
    gl.uniform1f(P.u.uDt, dt);
    gl.uniform1f(P.u.uIntro, intro);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.stateIdx = dst;
    this.stateDirty = true;
  };

  LiquidEngine.prototype.draw = function () {
    if (!this.ready || this.lost || this.destroyed) return;
    var gl = this.gl;
    var o = this.opts;
    var r = this.rect;
    var rm = o.reducedMotion;
    var introVis = rm || !o.intro ? 1 : Math.pow(this.introT, 2.2);
    var base = o.ambient && !rm ? clamp(o.ambientIntensity, 0, 2) : 0;
    var amb = base + this.flowing * 0.85 * clamp(o.liquid, 0, 2) * (rm ? 0.3 : 1);
    var rest = o.restStyle === 'particles' ? 1 : 0;
    var br = o.bg[0], bg = o.bg[1], bb = o.bg[2];
    var ir = this.imgBg[0], ig = this.imgBg[1], ib = this.imgBg[2];
    var dpr = this.canvas.width / this.cssW;
    var pres = Math.max(this.presence, this.burst);
    var mx = this.mouse.x - r.x;
    var my = this.mouse.y - r.y;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    var I = this.pImg;
    gl.useProgram(I.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.uniform1i(I.u.uImg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.flowTex[this.flowIdx]);
    gl.uniform1i(I.u.uFlow, 1);
    gl.uniform2f(I.u.uRes, this.cssW, this.cssH);
    gl.uniform1f(I.u.uDpr, dpr);
    gl.uniform4f(I.u.uRect, r.x, r.y, r.w, r.h);
    gl.uniform3f(I.u.uBg, br, bg, bb);
    gl.uniform3f(I.u.uImgBg, ir, ig, ib);
    gl.uniform2f(I.u.uMouse, mx, my);
    gl.uniform1f(I.u.uPresence, pres);
    gl.uniform1f(I.u.uRadius, this.radiusPx());
    gl.uniform1f(I.u.uStrength, this.strength());
    gl.uniform1f(I.u.uTime, this.time);
    gl.uniform1f(I.u.uAmbient, amb);
    gl.uniform1f(I.u.uIntroVis, introVis);
    gl.uniform1f(I.u.uRest, rest);
    gl.uniform1f(I.u.uAlphaMode, this.alphaMode ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // em repouso, no modo "imagem", as partículas são invisíveis: pula tudo
    if (!this.n || (!this.stateDirty && rest === 0 && introVis >= 1)) return;

    var P = this.pPart;
    gl.useProgram(P.p);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex[this.stateIdx]);
    gl.uniform1i(P.u.uState, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.homeTex);
    gl.uniform1i(P.u.uHome, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.colTex);
    gl.uniform1i(P.u.uCol, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.flowTex[this.flowIdx]);
    gl.uniform1i(P.u.uFlow, 3);
    gl.uniform1i(P.u.uTexW, TEX_W);
    gl.uniform4f(P.u.uRect, r.x, r.y, r.w, r.h);
    gl.uniform2f(P.u.uRes, this.cssW, this.cssH);
    gl.uniform2f(P.u.uMouse, mx, my);
    gl.uniform1f(P.u.uRadius, this.radiusPx());
    gl.uniform1f(P.u.uPresence, pres);
    var spacing = r.w / this.gridW;
    gl.uniform1f(P.u.uDot, spacing * 1.45 * clamp(o.dotSize, 0.2, 3));
    gl.uniform1f(P.u.uTime, this.time);
    gl.uniform1f(P.u.uAmbient, amb);
    gl.uniform1f(P.u.uStreak, (o.streaks ? 1 : 0) * (0.45 + 0.55 * introVis));
    gl.uniform1f(P.u.uIntroVis, introVis);
    gl.uniform1f(P.u.uRest, rest);
    gl.uniform1f(P.u.uDpr, dpr);
    if (this.alphaMode) gl.uniform3f(P.u.uTint, 1, 1, 1);
    else gl.uniform3f(P.u.uTint, br / Math.max(ir, 0.001), bg / Math.max(ig, 0.001), bb / Math.max(ib, 0.001));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
    gl.disable(gl.BLEND);
  };

  LiquidEngine.prototype.destroy = function () {
    this.destroyed = true;
    this.stop();
    var gl = this.gl;
    if (!this.lost) {
      gl.deleteBuffer(this.quad);
      gl.deleteVertexArray(this.vao);
      var texs = this.flowTex.concat(this.stateTex, [this.imgTex, this.homeTex, this.colTex]);
      for (var i = 0; i < texs.length; i++) if (texs[i]) gl.deleteTexture(texs[i]);
      var fbs = this.flowFb.concat(this.stateFb);
      for (var j = 0; j < fbs.length; j++) gl.deleteFramebuffer(fbs[j]);
      var progs = [this.pFlow, this.pSim, this.pPart, this.pImg];
      for (var k = 0; k < progs.length; k++) if (progs[k]) gl.deleteProgram(progs[k].p);
    }
    var ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  };

  /* ---------- imagem da escultura ----------
     Capelo de formatura dourado + wordmark, desenhados em canvas com
     fundo transparente — assim as partículas saem só do material
     (o motor detecta a transparência e usa o modo alpha). */

  function buildSculptureDataURL() {
    var W = 1600, H = 1000;
    var c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    var g = c.getContext('2d');
    if (!g) return '';
    var cx = 800;

    // copa (a parte que cabe na cabeça, sob o quadro)
    var cup = g.createLinearGradient(0, 380, 0, 710);
    cup.addColorStop(0, '#e8b93b');
    cup.addColorStop(1, '#9a7413');
    g.fillStyle = cup;
    g.beginPath();
    g.moveTo(566, 380);
    g.bezierCurveTo(566, 645, 660, 705, 800, 705);
    g.bezierCurveTo(940, 705, 1034, 645, 1034, 380);
    g.closePath();
    g.fill();

    // espessura do quadro (losango inferior, mais escuro)
    g.fillStyle = '#8a6410';
    g.beginPath();
    g.moveTo(cx, 132); g.lineTo(1400, 340); g.lineTo(cx, 548); g.lineTo(200, 340);
    g.closePath();
    g.fill();

    // topo do quadro (gradiente dourado)
    var gold = g.createLinearGradient(0, 100, 0, 560);
    gold.addColorStop(0, '#ffe9a3');
    gold.addColorStop(0.5, '#f5c542');
    gold.addColorStop(1, '#d9a41f');
    g.fillStyle = gold;
    g.beginPath();
    g.moveTo(cx, 110); g.lineTo(1400, 318); g.lineTo(cx, 526); g.lineTo(200, 318);
    g.closePath();
    g.fill();

    // botão central
    g.fillStyle = '#8a6410';
    g.beginPath();
    g.arc(cx, 318, 24, 0, Math.PI * 2);
    g.fill();

    // cordão: do botão até a borda direita, depois cai
    g.strokeStyle = '#f5c542';
    g.lineWidth = 14;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx, 322);
    g.quadraticCurveTo(1120, 358, 1305, 340);
    g.stroke();
    g.beginPath();
    g.moveTo(1305, 344);
    g.lineTo(1305, 560);
    g.stroke();

    // bojo do pendão
    g.fillStyle = '#ffe9a3';
    g.beginPath();
    g.arc(1305, 585, 27, 0, Math.PI * 2);
    g.fill();

    // saia do pendão
    var sk = g.createLinearGradient(0, 606, 0, 715);
    sk.addColorStop(0, '#f5c542');
    sk.addColorStop(1, '#b8860b');
    g.fillStyle = sk;
    g.beginPath();
    g.moveTo(1281, 606);
    g.lineTo(1329, 606);
    g.lineTo(1345, 715);
    g.lineTo(1265, 715);
    g.closePath();
    g.fill();
    // fios do pendão
    g.strokeStyle = 'rgba(122,90,10,.5)';
    g.lineWidth = 5;
    for (var i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(1305 + i * 16, 612);
      g.lineTo(1305 + i * 22, 708);
      g.stroke();
    }

    // wordmark
    g.font = '800 118px "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    var t1 = 'PROFESSOR DO ';
    var t2 = 'FUTURO';
    var w1 = g.measureText(t1).width;
    var w2 = g.measureText(t2).width;
    var x0 = cx - (w1 + w2) / 2;
    g.fillStyle = '#ffffff';
    g.fillText(t1, x0, 890);
    g.fillStyle = '#ffd76a';
    g.fillText(t2, x0 + w1, 890);

    return c.toDataURL('image/png');
  }

  /* ---------- layout: a escultura centrada no palco ---------- */

  function fitRect(cw, ch, aspect, scale) {
    var rw = cw * 0.99 * scale;
    var rh = rw / aspect;
    var maxH = ch * 0.99 * scale;
    if (rh > maxH) {
      rh = maxH;
      rw = rh * aspect;
    }
    return { x: (cw - rw) / 2, y: (ch - rh) / 2, w: rw, h: rh };
  }

  /* ---------- componente: monta tudo dentro de [data-sculpture] ---------- */

  var DEFAULTS = {
    scale: 1,
    interactive: true,
    strength: 1.05,
    radius: 200,
    particleDensity: 1,
    dotSize: 1,
    particleSpread: 1,
    turbulence: 1,
    liquid: 1,
    streaks: true,
    restStyle: 'image',
    returnSpeed: 1,
    ambient: false,
    speed: 1,
    intro: true,
    background: '#0d3a23'
  };

  function mountSculptureHero(stage, options) {
    var o = {};
    var key;
    for (key in DEFAULTS) o[key] = DEFAULTS[key];
    for (key in options) if (options[key] !== undefined) o[key] = options[key];

    var coarse = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    var hintEl = stage.querySelector('.sculpt-hint');
    if (hintEl && coarse) hintEl.textContent = 'Toque na escultura ✨';

    // fallback estático (sem WebGL2, sem float targets, etc.)
    var fallback = stage.querySelector('.sculpt-fallback');
    var dataUrl = buildSculptureDataURL();
    if (fallback && dataUrl) fallback.src = dataUrl;
    if (!dataUrl) return;
    stage.dataset.gl = 'off';

    // canvas vivo por engine: um contexto WebGL liberado nunca é reutilizado
    var canvas = document.createElement('canvas');
    canvas.className = 'sculpt-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    stage.appendChild(canvas);

    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    var engine = null;
    var fail = function () {
      stage.dataset.gl = 'off';
    };
    var engineOpts = function (rm) {
      return {
        interactive: !!o.interactive,
        strength: clamp(o.strength, 0, 2),
        radius: clamp(o.radius, 40, 600),
        density: clamp(o.particleDensity, 0.15, 2),
        dotSize: clamp(o.dotSize, 0.2, 3),
        spread: clamp(o.particleSpread, 0, 2),
        turbulence: clamp(o.turbulence, 0, 2),
        liquid: clamp(o.liquid, 0, 2),
        streaks: !!o.streaks,
        restStyle: o.restStyle,
        returnSpeed: clamp(o.returnSpeed, 0, 2),
        ambient: !!o.ambient,
        ambientIntensity: 1,
        speed: clamp(o.speed, 0.25, 3),
        intro: !!o.intro,
        reducedMotion: rm,
        bg: hexToRgb(o.background, [0.05, 0.23, 0.14]),
        imgBg: null
      };
    };
    try {
      engine = new LiquidEngine(canvas, engineOpts(mq.matches), fail);
    } catch (err) {
      fail();
      return;
    }

    var aspect = 1.6;
    var relayout = function () {
      var w = stage.clientWidth;
      var h = stage.clientHeight;
      if (!w || !h) return;
      var rect = fitRect(w, h, aspect, clamp(o.scale, 0.3, 3));
      engine.resize(w, h, rect);
    };

    var ro = new ResizeObserver(relayout);
    ro.observe(stage);
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        engine.setVisible(entries[i].isIntersecting && !document.hidden);
      }
    });
    io.observe(stage);
    var onVis = function () { engine.setVisible(!document.hidden); };
    document.addEventListener('visibilitychange', onVis);
    var onMq = function () { engine.setOptions({ reducedMotion: mq.matches }); };
    if (mq.addEventListener) mq.addEventListener('change', onMq);

    var pos = function (e) {
      var b = stage.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top];
    };
    var touched = false;
    var markTouched = function () {
      if (!touched) {
        touched = true;
        stage.dataset.touched = '1';
      }
    };
    var onMove = function (e) {
      var p = pos(e);
      var touch = e.pointerType === 'touch';
      if (touch && e.buttons === 0 && e.pressure === 0) return;
      engine.pointer('move', p[0], p[1], touch);
      markTouched();
    };
    var onDown = function (e) {
      var p = pos(e);
      engine.pointer('down', p[0], p[1], e.pointerType === 'touch');
      markTouched();
    };
    var onUp = function (e) {
      var p = pos(e);
      engine.pointer('up', p[0], p[1], e.pointerType === 'touch');
    };
    var onLeave = function (e) {
      var p = pos(e);
      engine.pointer('leave', p[0], p[1], e.pointerType === 'touch');
    };
    stage.addEventListener('pointermove', onMove, { passive: true });
    stage.addEventListener('pointerdown', onDown, { passive: true });
    stage.addEventListener('pointerup', onUp, { passive: true });
    stage.addEventListener('pointercancel', onUp, { passive: true });
    stage.addEventListener('pointerleave', onLeave, { passive: true });

    // imagem da escultura (gerada no canvas → data URL, mesma origem)
    var image = new Image();
    image.decoding = 'async';
    image.onload = function () {
      aspect = image.naturalWidth / image.naturalHeight || aspect;
      relayout();
      try {
        engine.onFirstFrame = function () {
          stage.dataset.gl = 'on';
        };
        engine.setImage(image);
        relayout();
      } catch (err) {
        fail();
      }
    };
    image.onerror = fail;
    image.src = dataUrl;
  }

  /* ---------- boot ---------- */

  function boot() {
    var stages = document.querySelectorAll('[data-sculpture]');
    for (var i = 0; i < stages.length; i++) mountSculptureHero(stages[i], {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();













