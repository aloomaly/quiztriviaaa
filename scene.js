/* ALTITUDE — cinematic takeoff scene (Three.js r128, no build step).
   Everything is procedural: aircraft, airport, sky, clouds. No external assets. */
(function () {
'use strict';
const API = window.SkyScene = { ok: false, T: 0, introDone: false };

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); }
  catch (e) { return false; }
}

API.init = function (canvas, opts) {
  opts = opts || {};
  if (typeof THREE === 'undefined' || !webglOK()) return false;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, stencil: false,
      powerPreference: 'high-performance'
    });
  } catch (e) { return false; }

  const mobile = matchMedia('(max-width: 820px)').matches || /Mobi|Android/i.test(navigator.userAgent);
  const reduced = !!opts.reduced;
  const INTRO = 48;
  const SKIP_T = 52;

  /* adaptive resolution: start modest, climb while the frame rate allows, back off when it doesn't */
  const PR_MAX = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  const PR_MIN = mobile ? .6 : .75;
  let pr = Math.min(PR_MAX, mobile ? 1.0 : 1.5);
  renderer.setPixelRatio(pr);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  const NOSHADOW = /[?&]noshadow\b/.test(location.search);
  console.info('[ALTITUDE] scene.js build v8 (cockpit windows restored) · THREE r' + THREE.REVISION +
    ' · debug flags: ?noenv  ?noshadow');
  renderer.shadowMap.enabled = !mobile && !NOSHADOW;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const sm = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  const lerp = (a, b, t) => a + (b - a) * t;
  const C = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  const rng = (seed) => () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 40000);

  const sunDir = new THREE.Vector3(0.55, 0.17, -0.82).normalize();
  const FOG = new THREE.Color(0.95, 0.66, 0.42);

  scene.fog = new THREE.FogExp2(FOG, 0.00026);

  /* ───────────── Sky ───────────── */

  const skyUniforms = {
    uSun: { value: sunDir },
    uLin: { value: 0 },
    uAlt: { value: 0 }
  };

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: skyUniforms,

    vertexShader:
      'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position.z = gl_Position.w; }',

    fragmentShader: `
      uniform vec3 uSun;
      uniform float uLin;
      uniform float uAlt;
      varying vec3 vD;

      void main(){
        vec3 d = normalize(vD);
        float h = d.y;

        vec3 zen  = vec3(0.06,0.16,0.38);
        vec3 hi   = vec3(0.30,0.50,0.80);
        vec3 mid  = vec3(0.88,0.74,0.70);
        vec3 hor  = vec3(1.00,0.62,0.28);
        vec3 haze = vec3(1.00,0.68,0.38);

        float t = clamp(h,0.,1.);

        vec3 col = mix(hor, mid, smoothstep(0.0,0.2,t));
        col = mix(col, hi, smoothstep(0.14,0.55,t));
        col = mix(col, zen, smoothstep(0.5,1.0,t));

        float s = max(dot(d,uSun),0.);

        col += vec3(1.0,0.55,0.22)*pow(s,4.)*0.6;
        col += vec3(1.0,0.75,0.40)*pow(s,36.)*0.8;
        col += vec3(1.0,0.95,0.8)*smoothstep(0.9992,0.9997,s)*3.0;

        col = mix(col, haze, 1.0 - smoothstep(-0.07,0.015,h));
        col = mix(col, col*vec3(0.84,0.94,1.1), uAlt*0.55);

        if(uLin>0.5)
          col = pow(col, vec3(2.2));

        gl_FragColor = vec4(col,1.);
      }`
  });

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(20000, 32, 16),
    skyMat
  );

  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  {
    /*
     * Environment (IBL) built from a plain 2D canvas instead of rendering a
     * custom ShaderMaterial through PMREM. This is an ordinary LDR sRGB
     * equirect texture, the most portable path in r128, so it cannot hit the
     * RGBE-encoding trap. It is a per-pixel port of the sky shader above.
     * Add ?noenv to the page URL to disable it for debugging.
     */
    if (!/[?&]noenv\b/.test(location.search)) {

      const envTex = canvasTex(256, 128, (ctx, w, h) => {

        const img = ctx.createImageData(w, h);
        const px = img.data;
        const ss = (a, b, x) => {
          const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return t * t * (3 - 2 * t);
        };
        const mx = (a, b, t) => a + (b - a) * t;
        const mix3 = (a, b, t) => [mx(a[0], b[0], t), mx(a[1], b[1], t), mx(a[2], b[2], t)];

        const zen = [0.06, 0.16, 0.38];
        const hi = [0.30, 0.50, 0.80];
        const mid = [0.88, 0.74, 0.70];
        const hor = [1.00, 0.62, 0.28];
        const haze = [1.00, 0.68, 0.38];

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {

            const phi = ((x + .5) / w - .5) * Math.PI * 2;
            const th = ((1 - (y + .5) / h) - .5) * Math.PI;
            const dx = Math.cos(th) * Math.cos(phi);
            const dy = Math.sin(th);
            const dz = Math.cos(th) * Math.sin(phi);

            const t = Math.min(1, Math.max(0, dy));
            let c = mix3(hor, mid, ss(0, .2, t));
            c = mix3(c, hi, ss(.14, .55, t));
            c = mix3(c, zen, ss(.5, 1, t));

            const sd = Math.max(dx * sunDir.x + dy * sunDir.y + dz * sunDir.z, 0);
            const g1 = Math.pow(sd, 4) * .6;
            const g2 = Math.pow(sd, 36) * .8;
            c = [c[0] + g1 + g2, c[1] + g1 * .55 + g2 * .75, c[2] + g1 * .22 + g2 * .4];

            c = mix3(c, haze, 1 - ss(-.07, .015, dy));

            const k = (y * w + x) * 4;
            px[k] = Math.min(255, Math.max(0, c[0] * 255));
            px[k + 1] = Math.min(255, Math.max(0, c[1] * 255));
            px[k + 2] = Math.min(255, Math.max(0, c[2] * 255));
            px[k + 3] = 255;
          }
        }

        ctx.putImageData(img, 0, 0);
      });

      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromEquirectangular(envTex).texture;
      pmrem.dispose();
      envTex.dispose();
    }
  }

  /* ───────────── Lighting ───────────── */

  const sun = new THREE.DirectionalLight(0xffb878, 2.7);

  sun.castShadow = !mobile && !NOSHADOW;
  sun.shadow.mapSize.set(2048, 2048);

  Object.assign(sun.shadow.camera, {
    left: -62,
    right: 62,
    top: 62,
    bottom: -62,
    near: 10,
    far: 900
  });

  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;

  scene.add(sun, sun.target);

  scene.add(
    new THREE.HemisphereLight(
      0xa9c8ea,
      0x6a5a48,
      0.55
    )
  );

  /*
   * Extra aircraft fill light.
   *
   * The original cinematic lighting could leave the aircraft
   * looking almost completely black when viewed from underneath.
   * This gives the livery enough fill light to remain visible.
   */
  const aircraftFill = new THREE.DirectionalLight(0xffffff, 1.15);
  aircraftFill.position.set(-120, 220, 180);
  aircraftFill.target.position.set(0, 0, 0);

  scene.add(aircraftFill, aircraftFill.target);

  /*
   * Soft cool bounce from below (runway / ground spill). Only surfaces
   * that face downward can receive it, so it lifts the blue belly and
   * wing undersides without touching the ground or the airport.
   */
  const aircraftBounce = new THREE.DirectionalLight(0x9db6d4, 0.7);
  aircraftBounce.position.set(60, -140, -90);
  aircraftBounce.target.position.set(0, 0, 0);

  scene.add(aircraftBounce, aircraftBounce.target);

  /* ───────────── Canvas texture helpers ───────────── */

  function canvasTex(w, h, draw, srgb) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;

    draw(c.getContext('2d'), w, h);

    const t = new THREE.CanvasTexture(c);

    if (srgb !== false)
      t.encoding = THREE.sRGBEncoding;

    t.anisotropy = Math.min(
      mobile ? 2 : 8,
      renderer.capabilities.getMaxAnisotropy()
    );

    return t;
  }

  const noise = (ctx, w, h, n, a, r) => {
    for (let i = 0; i < n; i++) {
      const v = (r() * 255) | 0;

      ctx.fillStyle =
        `rgba(${v},${v},${v},${a})`;

      ctx.fillRect(
        r() * w,
        r() * h,
        1 + r() * 2,
        1 + r() * 2
      );
    }
  };

  /* ───────────── Glow points ───────────── */

  const glowUniforms = {
    uScale: { value: 800 },
    uFog: { value: 0.00026 }
  };

  const glowMat = new THREE.ShaderMaterial({
    uniforms: glowUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,

    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;

      varying vec3 vC;
      varying float vA;

      uniform float uScale;
      uniform float uFog;

      void main(){

        vC = aColor;

        vec4 mv = modelViewMatrix * vec4(position,1.);

        float d = max(-mv.z,1.);

        vA =
          aAlpha *
          exp(-pow(d*uFog,2.));

        gl_PointSize =
          clamp(aSize*uScale/d,1.5,200.);

        gl_Position =
          projectionMatrix * mv;
      }`,

    fragmentShader: `
      varying vec3 vC;
      varying float vA;

      void main(){

        float d =
          length(gl_PointCoord-0.5)*2.;

        float a =
          smoothstep(1.,0.,d);

        a *= a;

        gl_FragColor =
          vec4(vC,a*vA);
      }`
  });

  function makeGlow(n) {

    const g = new THREE.BufferGeometry();

    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array(n * 3),
        3
      )
    );

    g.setAttribute(
      'aColor',
      new THREE.BufferAttribute(
        new Float32Array(n * 3).fill(1),
        3
      )
    );

    g.setAttribute(
      'aSize',
      new THREE.BufferAttribute(
        new Float32Array(n).fill(1),
        1
      )
    );

    g.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(
        new Float32Array(n),
        1
      )
    );

    const p = new THREE.Points(g, glowMat);

    p.frustumCulled = false;

    return p;
  }

  function staticGlow(list, color, size, alpha) {

    const p = makeGlow(list.length);
    const a = p.geometry.attributes;

    list.forEach((v, i) => {

      a.position.setXYZ(
        i,
        v[0],
        v[1],
        v[2]
      );

      a.aColor.setXYZ(
        i,
        color[0],
        color[1],
        color[2]
      );

      a.aSize.setX(i, size);
      a.aAlpha.setX(i, alpha);
    });

    scene.add(p);

    return p;
  }

  /* ───────────── Ground ───────────── */

  const GS = 30000;
  const GREP = 700;

  const grassTex = canvasTex(
    512,
    512,
    (ctx, w, h) => {

      const r = rng(7);

      ctx.fillStyle = '#4a4f30';
      ctx.fillRect(0,0,w,h);

      for (let i = 0; i < 140; i++) {

        ctx.fillStyle =
          `rgba(${60 + r()*40},${64 + r()*36},${30 + r()*20},.25)`;

        ctx.beginPath();

        ctx.arc(
          r()*w,
          r()*h,
          20+r()*70,
          0,
          7
        );

        ctx.fill();
      }

      noise(
        ctx,
        w,
        h,
        6000,
        .1,
        r
      );
    }
  );

  grassTex.wrapS =
    grassTex.wrapT =
    THREE.RepeatWrapping;

  grassTex.repeat.set(
    GREP,
    GREP
  );

  const ground =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        GS,
        GS
      ),
      new THREE.MeshStandardMaterial({
        map: grassTex,
        roughness: 1,
        metalness: 0,
        color: C('#b0a890')
      })
    );

  ground.rotation.x =
    -Math.PI / 2;

  ground.receiveShadow = true;

  scene.add(ground);

  /* ───────────── Runway ───────────── */

  const RWY_L = 4200;
  const RWY_Z0 = 300;

  const asphalt = canvasTex(
    512,
    1024,
    (ctx,w,h) => {

      const r = rng(11);

      ctx.fillStyle = '#34363a';
      ctx.fillRect(0,0,w,h);

      for (let i=0;i<70;i++) {

        const v = 44+r()*14;

        ctx.fillStyle =
          `rgba(${v},${v+1},${v+3},.35)`;

        ctx.fillRect(
          r()*w,
          r()*h,
          30+r()*140,
          20+r()*120
        );
      }

      noise(
        ctx,
        w,
        h,
        16000,
        .12,
        r
      );

      ctx.fillStyle =
        '#d9d7d0';

      ctx.fillRect(
        14,
        0,
        8,
        h
      );

      ctx.fillRect(
        w-22,
        0,
        8,
        h
      );

      [0,512].forEach(y =>
        ctx.fillRect(
          w/2-4,
          y,
          8,
          256
        )
      );

      ctx.fillStyle =
        'rgba(15,15,18,.28)';

      for(let i=0;i<9;i++) {

        ctx.fillRect(
          w/2-40+i*4+r()*70-35,
          300+r()*600,
          3,
          80+r()*130
        );
      }
    }
  );

  asphalt.wrapS =
    asphalt.wrapT =
    THREE.RepeatWrapping;

  asphalt.repeat.set(
    1,
    RWY_L/120
  );

  const runway =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        60,
        RWY_L
      ),
      new THREE.MeshStandardMaterial({
        map: asphalt,
        roughness: .72,
        metalness: .05,
        envMapIntensity: .7
      })
    );

  runway.rotation.x =
    -Math.PI/2;

  runway.position.set(
    0,
    .12,
    RWY_Z0-RWY_L/2
  );

  runway.receiveShadow = true;

  scene.add(runway);

  const markTex =
    canvasTex(
      512,
      512,
      (ctx,w,h)=>{

        ctx.clearRect(
          0,
          0,
          w,
          h
        );

        ctx.fillStyle =
          '#e4e2da';

        for(let i=0;i<12;i++)
          ctx.fillRect(
            40+i*36+(i>5?20:0),
            10,
            22,
            190
          );

        ctx.font =
          '700 150px Sora, Arial';

        ctx.textAlign =
          'center';

        ctx.fillText(
          '09',
          w/2,
          400
        );
      }
    );

  const mark =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        60,
        60
      ),
      new THREE.MeshStandardMaterial({
        map: markTex,
        transparent:true,
        roughness:.8
      })
    );

  mark.rotation.x =
    -Math.PI/2;

  mark.position.set(
    0,
    .16,
    RWY_Z0-42
  );

  mark.receiveShadow = true;

  scene.add(mark);

  const aimTex =
    canvasTex(
      256,
      256,
      (ctx,w,h)=>{

        ctx.fillStyle =
          '#e4e2da';

        ctx.fillRect(
          30,
          40,
          50,
          180
        );

        ctx.fillRect(
          w-80,
          40,
          50,
          180
        );

        for(let i=0;i<3;i++){

          ctx.fillRect(
            100,
            40+i*30,
            12,
            20
          );

          ctx.fillRect(
            w-112,
            40+i*30,
            12,
            20
          );
        }
      }
    );

  [-300,-700].forEach(z=>{

    const m =
      new THREE.Mesh(
        new THREE.PlaneGeometry(
          40,
          40
        ),
        new THREE.MeshStandardMaterial({
          map:aimTex,
          transparent:true,
          roughness:.8
        })
      );

    m.rotation.x =
      -Math.PI/2;

    m.position.set(
      0,
      .16,
      z
    );

    m.receiveShadow = true;

    scene.add(m);
  });

  /* ───────────── Apron ───────────── */

  const apron =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        260,
        900
      ),
      new THREE.MeshStandardMaterial({
        map: asphalt,
        color: C('#9a9a9a'),
        roughness:.8
      })
    );

  apron.material.map =
    asphalt.clone();

  apron.material.map.needsUpdate =
    true;

  apron.material.map.wrapS =
    apron.material.map.wrapT =
    THREE.RepeatWrapping;

  apron.material.map.repeat.set(
    4,
    8
  );

  apron.rotation.x =
    -Math.PI/2;

  apron.position.set(
    -170,
    .1,
    -140
  );

  apron.receiveShadow = true;

  scene.add(apron);

  const taxi =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        26,
        900
      ),
      new THREE.MeshStandardMaterial({
        color:C('#3a3c40'),
        roughness:.8
      })
    );

  taxi.rotation.x =
    -Math.PI/2;

  taxi.position.set(
    -100,
    .11,
    -140
  );

  scene.add(taxi);

  /* ───────────── Runway lights ───────────── */

  {
    const edge=[];
    const gl=[];
    const rd=[];

    for(
      let z=RWY_Z0;
      z>RWY_Z0-RWY_L;
      z-=60
    ){
      edge.push(
        [-32,.5,z],
        [32,.5,z]
      );
    }

    for(
      let x=-28;
      x<=28;
      x+=5.6
    ){
      gl.push([
        x,
        .5,
        RWY_Z0+2
      ]);

      rd.push([
        x,
        .5,
        RWY_Z0-RWY_L-2
      ]);
    }

    for(
      let z=RWY_Z0+40;
      z<RWY_Z0+900;
      z+=30
    ){
      edge.push([
        0,
        .9,
        z
      ]);
    }

    staticGlow(
      edge,
      [1,.78,.5],
      1.7,
      .95
    );

    staticGlow(
      gl,
      [.2,1,.4],
      1.8,
      .95
    );

    staticGlow(
      rd,
      [1,.15,.12],
      1.8,
      .95
    );
  }

  /* ───────────── Airport ───────────── */

  const airport =
    new THREE.Group();

  scene.add(airport);

  {
    const facade =
      canvasTex(
        512,
        128,
        (ctx,w,h)=>{

          const r=rng(3);

          ctx.fillStyle =
            '#8e969f';

          ctx.fillRect(
            0,
            0,
            w,
            h
          );

          for(
            let x=0;
            x<w;
            x+=16
          )
          for(
            let y=14;
            y<h-10;
            y+=28
          ){

            ctx.fillStyle =
              r()>.3
              ? '#2b3b4c'
              : '#1c2733';

            ctx.fillRect(
              x+2,
              y,
              12,
              18
            );
          }
        }
      );

    facade.wrapS =
      facade.wrapT =
      THREE.RepeatWrapping;

    facade.repeat.set(
      10,
      1
    );

    const lit =
      canvasTex(
        512,
        128,
        (ctx,w,h)=>{

          const r=rng(5);

          ctx.fillStyle='#000';

          ctx.fillRect(
            0,
            0,
            w,
            h
          );

          for(
            let x=0;
            x<w;
            x+=16
          )
          for(
            let y=14;
            y<h-10;
            y+=28
          ){

            if(r()>.45){

              ctx.fillStyle =
                r()>.5
                ? '#ffcf8a'
                : '#ffe9c2';

              ctx.fillRect(
                x+2,
                y,
                12,
                18
              );
            }
          }
        }
      );

    lit.wrapS =
      lit.wrapT =
      THREE.RepeatWrapping;

    lit.repeat.set(
      10,
      1
    );

    const bm =
      new THREE.MeshStandardMaterial({
        map:facade,
        emissiveMap:lit,
        emissive:0xffffff,
        emissiveIntensity:.7,
        roughness:.6,
        metalness:.2
      });

    const roofM =
      new THREE.MeshStandardMaterial({
        color:C('#d9dde2'),
        roughness:.5
      });

    const addAirport =
      (g,m,x,y,z)=>{

        const o =
          new THREE.Mesh(
            g,
            m
          );

        o.position.set(
          x,
          y,
          z
        );

        o.castShadow=true;
        o.receiveShadow=true;

        airport.add(o);

        return o;
      };

    addAirport(
      new THREE.BoxGeometry(
        70,
        20,
        430
      ),
      bm,
      -330,
      10,
      -70
    );

    addAirport(
      new THREE.BoxGeometry(
        76,
        2.5,
        436
      ),
      roofM,
      -330,
      21,
      -70
    );

    for(let i=0;i<5;i++){

      addAirport(
        new THREE.BoxGeometry(
          150,
          12,
          24
        ),
        bm,
        -250,
        6,
        -230+i*88-24
      );
    }

    addAirport(
      new THREE.CylinderGeometry(
        4.2,
        5.4,
        64,
        20
      ),
      new THREE.MeshStandardMaterial({
        color:C('#cfd5db'),
        roughness:.5
      }),
      -300,
      32,
      210
    );

    addAirport(
      new THREE.CylinderGeometry(
        10,
        8,
        9,
        20
      ),
      new THREE.MeshStandardMaterial({
        color:C('#1b2a38'),
        roughness:.2,
        metalness:.6,
        emissive:0x2a3a4a,
        emissiveIntensity:.5
      }),
      -300,
      68,
      210
    );

    addAirport(
      new THREE.CylinderGeometry(
        11,
        11,
        1.4,
        20
      ),
      roofM,
      -300,
      73.4,
      210
    );

    for(let i=0;i<3;i++){

      const h =
        addAirport(
          new THREE.CylinderGeometry(
            24,
            24,
            120,
            16,
            1,
            false,
            0,
            Math.PI
          ),
          new THREE.MeshStandardMaterial({
            color:C('#8a949e'),
            roughness:.5,
            metalness:.3,
            side:THREE.DoubleSide
          }),
          -150,
          0,
          360+i*70
        );

      h.rotation.set(
        Math.PI/2,
        0,
        Math.PI/2
      );

      h.position.y=.1;
    }
  }

  /* ───────────── Airport & city world ───────────── */

  /*
   * A much richer, fully procedural airport that replaces the simple
   * original buildings: multi-section glass terminal with piers and jet
   * bridges, control tower, hangars, service/cargo compounds, taxiways with
   * lights and signs, perimeter roads and fences, parking, ground vehicles,
   * and a hazy distant city. Shared geometry/materials and InstancedMesh
   * batching keep the draw-call count low. Nothing here touches the aircraft.
   */

  const CITY_P = 6000;
  const city = new THREE.Group();
  scene.add(city);
  let worldUpdate = function () {};

  {
    const LOD = 1;   // full detail everywhere
    airport.visible = false;   // original simple airport is replaced below
    airport.traverse(o => { o.updateMatrix(); o.matrixAutoUpdate = false; });
    taxi.visible = false;

    const world = new THREE.Group();
    scene.add(world);

    const wr = rng(20251122);
    const rr = (a, b) => a + (b - a) * wr();
    const pick = (arr) => arr[Math.floor(wr() * arr.length) % arr.length];

    /* ── shared unit geometry (base at y=0) ── */

    const unit = (g) => { g.translate(0, .5, 0); return g; };
    const boxG = unit(new THREE.BoxGeometry(1, 1, 1));
    const cylG = unit(new THREE.CylinderGeometry(1, 1, 1, 14));
    const shaftG = unit(new THREE.CylinderGeometry(.75, 1, 1, 16));
    const skirtG = unit(new THREE.CylinderGeometry(1, .5, 1, 20));
    const ringG = unit(new THREE.CylinderGeometry(1, 1, 1, 28, 1, true));
    const coneG = unit(new THREE.ConeGeometry(1, 1, 8));
    const bushG = new THREE.IcosahedronGeometry(1, 1);

    const prismG = (() => {
      const s = new THREE.Shape();
      s.moveTo(-1, 0); s.lineTo(1, 0); s.lineTo(0, 1); s.lineTo(-1, 0);
      const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
      g.translate(0, 0, -.5);
      return g;
    })();

    const archG = (() => {
      const s = new THREE.Shape();
      s.moveTo(-1, 0); s.lineTo(1, 0); s.lineTo(1, .45);
      s.absarc(0, .45, 1, 0, Math.PI, false);
      s.lineTo(-1, 0);
      const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 16 });
      g.translate(0, 0, -.5);
      return g;
    })();

    /* ── instancing helper ── */

    const batches = [];

    function Batch(geo, mat, parent) {
      const L = [];
      const b = {
        add(x, y, z, sx, sy, sz, ry) { L.push(x, y, z, sx, sy, sz, ry || 0); return b; },
        build() {
          const n = L.length / 7;
          if (!n) return;
          const m = new THREE.InstancedMesh(geo, mat, n);
          const o = new THREE.Object3D();
          for (let i = 0; i < n; i++) {
            const k = i * 7;
            o.position.set(L[k], L[k + 1], L[k + 2]);
            o.scale.set(L[k + 3], L[k + 4], L[k + 5]);
            o.rotation.set(0, L[k + 6], 0);
            o.updateMatrix();
            m.setMatrixAt(i, o.matrix);
          }
          m.instanceMatrix.needsUpdate = true;
          m.frustumCulled = false;
          parent.add(m);
        }
      };
      batches.push(b);
      return b;
    }

    const put = (geo, mat, x, y, z, sx, sy, sz, ry, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.rotation.y = ry || 0;
      (parent || world).add(m);
      return m;
    };

    const glows = { blue: [], green: [], warm: [], red: [], white: [] };

    /* ── materials ── */

    const lam = (hex, extra) =>
      new THREE.MeshLambertMaterial(Object.assign({ color: C(hex) }, extra || {}));

    const mConc = lam('#a9a8a3');
    const mConcD = lam('#767b80');
    const mWhite = lam('#dfe2e4');
    const mSlab = lam('#c6c9cb');
    const mRoofD = lam('#5f666d');
    const mDark = lam('#22272c');
    const mPole = lam('#6c7176');
    const mLamp = lam('#d8d2c0', { emissive: 0x6a5230 });
    const mYellow = lam('#cdaa2b');
    const mMetal = new THREE.MeshPhongMaterial({ color: C('#a9b2ba'), specular: 0x667078, shininess: 50 });
    const mHangar = new THREE.MeshPhongMaterial({ color: C('#a3adb5'), specular: 0x555d66, shininess: 35 });

    const rep = (t, x, y) => {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(x, y);
      c.needsUpdate = true;
      return c;
    };

    /* colour map + warm "lit windows" emissive map pair */
    function facadePair(w, h, cols, rows, base, pane, seed, litP) {
      const r = rng(seed);
      const paneRect = (ctx, c, rw) => {
        const cw = w / cols, rh = h / rows;
        ctx.fillRect(c * cw + cw * .14, rw * rh + rh * .2, cw * .72, rh * .6);
      };
      const map = canvasTex(w, h, (ctx) => {
        ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = pane;
        for (let c = 0; c < cols; c++) for (let q = 0; q < rows; q++) paneRect(ctx, c, q);
      });
      const em = canvasTex(w, h, (ctx) => {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
        for (let c = 0; c < cols; c++) for (let q = 0; q < rows; q++) {
          if (r() < litP) { ctx.fillStyle = r() > .5 ? '#ffcf8a' : '#ffe6bd'; paneRect(ctx, c, q); }
        }
      });
      return { map, em };
    }

    const termPair = facadePair(256, 128, 8, 3, '#2b3c4c', '#5d829f', 5, .2);
    const glassM = (rx, ry) => new THREE.MeshPhongMaterial({
      map: rep(termPair.map, rx, ry),
      emissiveMap: rep(termPair.em, rx, ry),
      emissive: 0xffffff, emissiveIntensity: .55,
      specular: 0x9fb3c6, shininess: 90
    });

    /* service-building wall: panel lines + window strip */
    const svcTex = canvasTex(128, 64, (ctx, w, h) => {
      ctx.fillStyle = '#d4d2cc'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      for (let x = 0; x < w; x += 16) ctx.fillRect(x, 0, 1, h);
      ctx.fillStyle = '#3d4c5a';
      for (let x = 6; x < w - 8; x += 16) ctx.fillRect(x, 20, 10, 14);
    });
    const wallMats = ['#b9b5ac', '#9fa4a8', '#cbc7be', '#8f9290', '#aa9f92']
      .map(h => new THREE.MeshLambertMaterial({ map: svcTex, color: C(h) }));
    const roofMats = ['#6d7378', '#86584a', '#7b8081'].map(h => lam(h));

    /* ──────────────── TERMINAL ──────────────── */

    const TX = -330;

    /* three connected sections with different heights */
    [[87.5, 115, 14, 50], [-60, 180, 19, 62], [-217.5, 135, 13, 50]].forEach(([cz, len, h, wd]) => {
      put(boxG, glassM(len / 24, h / 7.5), TX, 0, cz, wd, h, len);
      put(boxG, mSlab, TX, h, cz, wd + 5, 1.2, len + 4);
    });

    /* vaulted roof over the central hall, with skylight ribs */
    put(archG, mWhite, TX, 20.2, -60, 29, 8 / 1.45, 168);
    for (let i = 0; i < 9; i++) put(boxG, mConcD, TX, 20.2, -60 - 76 + i * 19, 60, .5, .8);

    /* rooftop plant on the lower sections */
    for (let i = 0; i < 10; i++) {
      const sec = i % 2 ? [87.5, 14, 115] : [-217.5, 13, 135];
      put(boxG, mConcD, TX + rr(-14, 14), sec[1] + 1.2, sec[0] + rr(-sec[2] / 2 + 8, sec[2] / 2 - 8), rr(4, 9), rr(1.5, 3.5), rr(4, 9));
    }

    /* piers (gates), hold rooms and jet bridges */
    const gateZ = [-254, -166, -78, 10, 98];
    gateZ.forEach(z => {
      put(boxG, glassM(115 / 24, 9 / 7.5), -247.5, 0, z, 115, 9, 20);
      put(boxG, mSlab, -247.5, 9, z, 118, 1, 23);
      put(boxG, glassM(14 / 24, 11 / 7.5), -197, 0, z, 14, 11, 26);
      put(boxG, mSlab, -197, 11, z, 16, 1, 28);
      put(boxG, mWhite, -186, 3.0, z, 9, 3, 3.2);          // jet-bridge tunnel
      put(cylG, mWhite, -181, 2.6, z, 2.6, 3.6, 2.6);      // bridge cab
      put(cylG, mDark, -181, .2, z, .5, 2.6, .5);          // support column
      glows.white.push([-182, 5.2, z]);
    });

    /* landside entrances, canopies and columns */
    [-150, -20, 110].forEach(z => {
      put(boxG, mSlab, -373, 6.2, z, 24, .9, 46);
      put(boxG, mDark, -361.5, 0, z, 1.5, 5, 18);
      [[-382, -20], [-382, 20], [-364, -20], [-364, 20]].forEach(([dx, dz]) =>
        put(cylG, mWhite, dx, 0, z + dz, .5, 6.2, .5));
      glows.warm.push([-362.5, 5.2, z - 9], [-362.5, 5.2, z + 9]);
    });

    /* service block and multi-storey car park at the south end */
    put(boxG, mConc, TX - 5, 0, 182, 40, 8, 58);
    put(boxG, mRoofD, TX - 5, 8, 182, 42, .7, 60);
    for (let i = 0; i < 4; i++) put(boxG, mDark, TX + 15.2, 0, 160 + i * 14, .3, 4.4, 7);

    const parkTex = canvasTex(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#9b9a95'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#3c4146';
      for (let y = 8; y < h; y += 32) ctx.fillRect(0, y, w, 14);
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 3, h);
    });
    put(boxG, new THREE.MeshLambertMaterial({ map: rep(parkTex, 3, 1) }), -455, 0, 250, 60, 22, 90);
    put(boxG, mConcD, -455, 22, 250, 62, .8, 92);

    /* ──────────────── CONTROL TOWER ──────────────── */

    {
      const tw = new THREE.Group();
      tw.position.set(-280, 0, 215);
      world.add(tw);

      put(boxG, mConc, 0, 0, 0, 26, 9, 26, 0, tw);
      put(boxG, mSlab, 0, 9, 0, 28, 1, 28, 0, tw);
      put(shaftG, mWhite, 0, 10, 0, 5.2, 52, 5.2, 0, tw);
      [26, 40, 52].forEach(y => put(cylG, mConcD, 0, y, 0, 4.4, .7, 4.4, 0, tw));
      put(skirtG, mWhite, 0, 62, 0, 11, 4, 11, 0, tw);

      const cabGlass = new THREE.MeshPhongMaterial({
        color: C('#1c2c3b'), specular: 0xaabbcc, shininess: 100,
        emissive: 0x5a3c1a, side: THREE.DoubleSide
      });
      put(ringG, cabGlass, 0, 66, 0, 11.6, 5.2, 11.6, 0, tw);
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2;
        put(boxG, mWhite, Math.cos(a) * 11.6, 66, Math.sin(a) * 11.6, .35, 5.2, .35, 0, tw);
      }
      put(cylG, mWhite, 0, 71.2, 0, 12.8, 1.1, 12.8, 0, tw);
      put(cylG, mConcD, 0, 72.3, 0, 7, 1.2, 7, 0, tw);
      put(cylG, mMetal, 0, 73.5, 0, .38, 11, .38, 0, tw);
      [[4, 5], [-4, 6.5], [0, 4.5]].forEach(([dx, hh], i) =>
        put(cylG, mMetal, dx, 73.5, i === 2 ? 4 : -2, .14, hh, .14, 0, tw));
      put(boxG, mDark, 5, 73.5, 3, 3.4, 1.2, .5, .6, tw);                 // radar
      glows.red.push([-280, 85.4, 215]);
    }

    /* ──────────────── HANGARS ──────────────── */

    const doorPair = (() => {
      const map = canvasTex(256, 128, (ctx, w, h) => {
        ctx.fillStyle = '#6d747c'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0,0,0,.28)';
        for (let x = 0; x <= w; x += 32) ctx.fillRect(x, 0, 2, h);
        ctx.fillStyle = '#c9a52a';
        for (let x = 0; x < w; x += 24) ctx.fillRect(x, h - 14, 12, 14);
        ctx.fillStyle = '#20252a';
        for (let x = 12; x < w; x += 24) ctx.fillRect(x, h - 14, 12, 14);
      });
      const em = canvasTex(256, 128, (ctx, w, h) => {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ffd596'; ctx.fillRect(0, 6, w, 5);
      });
      return { map, em };
    })();
    const mDoor = new THREE.MeshLambertMaterial({ map: doorPair.map, emissiveMap: doorPair.em, emissive: 0xffffff, emissiveIntensity: .7 });

    [[445, 72, 56, 19], [545, 86, 62, 22], [640, 60, 48, 16]].forEach(([cz, wZ, dX, H]) => {
      const cx = -255;
      put(archG, mHangar, cx, 0, cz, wZ / 2, H / 1.45, dX, Math.PI / 2);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(wZ * .85, H * .67), mDoor);
      door.position.set(cx + dX / 2 + .06, H * .335, cz);
      door.rotation.y = Math.PI / 2;
      world.add(door);
      put(boxG, mConcD, cx + dX / 2 + .2, 0, cz, .6, 1.1, wZ * .9);          // threshold
      glows.warm.push([cx + dX / 2 + 1, H * .72, cz - wZ * .35], [cx + dX / 2 + 1, H * .72, cz + wZ * .35]);
    });

    /* ──────────────── GROUND: taxiways, roads, lots, grass ──────────────── */

    glows.mast = [];

    const asphaltBase = (ctx, w, h, seed, col) => {
      ctx.fillStyle = col; ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, (w * h) / 5, .12, rng(seed));
    };

    const taxiV = canvasTex(64, 128, (ctx, w, h) => {
      asphaltBase(ctx, w, h, 31, '#393c40');
      ctx.fillStyle = '#d6b21f'; ctx.fillRect(w / 2 - 1, 0, 2, h);
    });
    const taxiH = canvasTex(128, 64, (ctx, w, h) => {
      asphaltBase(ctx, w, h, 32, '#393c40');
      ctx.fillStyle = '#d6b21f'; ctx.fillRect(0, h / 2 - 1, w, 2);
    });
    const roadV = canvasTex(64, 128, (ctx, w, h) => {
      asphaltBase(ctx, w, h, 33, '#2e3135');
      ctx.fillStyle = '#d9d9d2';
      ctx.fillRect(w / 2 - 1, 0, 2, h * .5);
      ctx.fillRect(3, 0, 2, h); ctx.fillRect(w - 5, 0, 2, h);
    });
    const lotTex = canvasTex(128, 64, (ctx, w, h) => {
      asphaltBase(ctx, w, h, 34, '#34373b');
      ctx.fillStyle = '#c9c9c2';
      [.125, .375, .625, .875].forEach(u => ctx.fillRect(u * w - 1, 0, 2, h));
      ctx.fillRect(.125 * w, 0, .25 * w, 2);
      ctx.fillRect(.625 * w, 0, .25 * w, 2);
    });
    const mownTex = canvasTex(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#58733b'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#4c6634'; ctx.fillRect(0, h / 2, w, h / 2);
      noise(ctx, w, h, 600, .1, rng(35));
    });
    const padTex = canvasTex(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#8e8e89'; ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 2500, .08, rng(36));
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(0, 0, w, 1); ctx.fillRect(0, 0, 1, h); ctx.fillRect(w / 2, 0, 1, h); ctx.fillRect(0, h / 2, w, 1);
    });
    const fenceTex = canvasTex(64, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(160,165,170,.95)'; ctx.lineWidth = 2;
      for (let i = -h; i < w + h; i += 16) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i + h, 0); ctx.lineTo(i, h); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(160,165,170,.95)'; ctx.fillRect(0, 0, w, 3);
    });

    /* flat textured ground plane; `layer` biases depth so layers never z-fight */
    const flat = (w, d, x, z, y, tex, rx, ry, layer) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshLambertMaterial({
          map: rep(tex, rx, ry),
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 * layer
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      world.add(m);
      return m;
    };

    /* mown airfield grass beside runway and taxiway */
    flat(100, 4330, 80, -1835, .04, mownTex, 1, 4330 / 30, 1);
    flat(58, 4330, -59, -1835, .04, mownTex, 1, 4330 / 30, 1);

    /* long parallel taxiway with centre-line, plus runway connectors */
    flat(24, 4600, -100, -1600, .13, taxiV, 1, 4600 / 20, 3);

    const connZ = [296, -700, -1500, -2300, -3100, -3880];
    const markB = Batch(boxG, mYellow, world);
    connZ.forEach(z => {
      flat(60, 22, -60, z, .14, taxiH, 3, 1, 4);
      for (let k = 0; k < 4; k++) markB.add(-44.5 - k * 1.1, .16, z, .3, .02, 20);
    });

    /* far-end runway number, matching the existing '09' at the start */
    {
      const tex27 = canvasTex(512, 512, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#e4e2da';
        for (let i = 0; i < 12; i++) ctx.fillRect(40 + i * 36 + (i > 5 ? 20 : 0), 10, 22, 190);
        ctx.font = '700 150px Sora, Arial'; ctx.textAlign = 'center';
        ctx.fillText('27', w / 2, 400);
      });
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        new THREE.MeshStandardMaterial({ map: tex27, transparent: true, roughness: .8 })
      );
      m.rotation.set(-Math.PI / 2, 0, Math.PI);
      m.position.set(0, .16, RWY_Z0 - RWY_L + 42);
      world.add(m);
    }

    /* concrete pads, forecourt, roads, car parks */
    flat(130, 290, -167, 540, .06, padTex, 13, 29, 2);                 // hangar apron
    flat(140, 1400, 260, -400, .06, padTex, 14, 140, 2);               // right cargo area
    flat(140, 1820, -500, -1290, .06, padTex, 14, 182, 2);             // left service compound
    flat(34, 470, -378, -70, .06, padTex, 3.4, 47, 2);                 // terminal forecourt
    flat(14, 840, -410, 0, .05, roadV, 1, 42, 2);                      // landside road
    flat(10, 4400, 160, -1800, .05, roadV, 1, 220, 2);                 // perimeter road
    flat(115, 200, -482.5, -160, .06, lotTex, 115 / 20, 200 / 2.7, 2); // car park 1
    flat(115, 190, -482.5, 65, .06, lotTex, 115 / 20, 190 / 2.7, 2);   // car park 2

    /* ──────────────── lights, poles, masts ──────────────── */

    const poleB = Batch(cylG, mPole, world);
    const lampB = Batch(boxG, mLamp, world);

    const addLamp = (x, z, h, dx) => {
      poleB.add(x, 0, z, .2, h, .2);
      lampB.add(x + dx, h, z, 1.8, .3, .6);
      glows.warm.push([x + dx, h - .1, z]);
    };

    for (let z = 300; z > -3900; z -= 60 * LOD) addLamp(154.5, z, 9, 1.0);
    for (let z = -400; z <= 400; z += 40 * LOD) addLamp(-402, z, 9, -1.2);
    for (let z = -250; z <= 250; z += 100) {                          // apron flood masts
      poleB.add(-136, 0, z, .45, 26, .45);
      lampB.add(-136, 26, z, 3.6, .5, 1.3);
      glows.mast.push([-136, 26, z]);
    }
    for (let a = 0; a < 5; a++) for (let z = -250; z < 150; z += 50 * LOD) {   // car park lamps
      if (a % 2) addLamp(-540 + a * 20 + 10, z, 8, 0);
    }

    /* taxiway edge (blue) and centre-line (green) lights */
    for (let z = 330; z > -3900; z -= 45 * LOD) glows.blue.push([-112, .4, z], [-88, .4, z]);
    for (let z = 700; z > -3900; z -= 30 * LOD) glows.green.push([-100, .25, z]);

    /* utility poles and radio masts */
    const woodM = lam('#5a4630');
    const uPoleB = Batch(cylG, woodM, world);
    const crossB = Batch(boxG, woodM, world);
    for (let i = 0; i < 12; i++) {
      const z = 250 - i * 85;
      uPoleB.add(168, 0, z, .18, 11, .18);
      crossB.add(168, 10, z, 2.6, .15, .15);
    }
    const mastB = Batch(coneG, mMetal, world);
    [[-515, -2310], [235, -2750], [300, 420]].forEach(([x, z]) => {
      mastB.add(x, 0, z, 1.1, 48, 1.1);
      glows.red.push([x, 48.5, z]);
    });

    /* ──────────────── fences ──────────────── */

    const mFence = new THREE.MeshLambertMaterial({ map: fenceTex, transparent: true, alphaTest: .3, side: THREE.DoubleSide });
    const postB = Batch(boxG, mPole, world);

    const fence = (x0, z0, x1, z1) => {
      const alongZ = x0 === x1;
      const L = alongZ ? Math.abs(z1 - z0) : Math.abs(x1 - x0);
      const tex = rep(fenceTex, L / 2.4, 1);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(L, 2.4),
        new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: .3, side: THREE.DoubleSide })
      );
      m.position.set((x0 + x1) / 2, 1.2, (z0 + z1) / 2);
      if (alongZ) m.rotation.y = Math.PI / 2;
      world.add(m);
      const n = Math.floor(L / (14 * LOD));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        postB.add(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t, .12, 2.6, .12);
      }
    };

    fence(138, 330, 138, -4000);                       // airfield perimeter (right)
    fence(-572, -370, -572, -2210);                    // service compound
    fence(-432, -370, -432, -2210);
    fence(-572, -2210, -432, -2210);
    fence(-572, -370, -432, -370);

    /* ──────────────── signs ──────────────── */

    const signTex = (txt, bg, fg) => canvasTex(128, 64, (ctx, w, h) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = fg; ctx.lineWidth = 3; ctx.strokeRect(3, 3, w - 6, h - 6);
      ctx.fillStyle = fg;
      ctx.font = '800 38px Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, w / 2, h / 2 + 2);
    });

    const signB = Batch(cylG, mPole, world);
    const sign = (x, z, txt, bg, fg) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 1.7),
        new THREE.MeshLambertMaterial({ map: signTex(txt, bg, fg), emissive: 0x332a18 })
      );
      m.position.set(x, 1.9, z);
      m.rotation.y = Math.PI / 2;
      world.add(m);
      signB.add(x - .06, 0, z, .07, 1.9, .07);
    };
    connZ.forEach((z, i) => {
      sign(-85, z + 15, 'A' + (i + 1), '#e3b80a', '#111');
      sign(-47, z - 15, '09/27', '#b3201d', '#fff');
    });
    sign(-85, 560, 'HANGARS', '#e3b80a', '#111');
    sign(-215, 120, 'GATES 1-5', '#e3b80a', '#111');

    /* ──────────────── vehicles ──────────────── */

    const CAR = ['#8c1f1f', '#1f3f7a', '#d9d9d6', '#2b2b2e', '#9aa0a6', '#2e5d3a', '#c9b27a', '#6b3f2a'];
    const carMats = CAR.map(h => lam(h));
    const cabMat = lam('#222c35');
    const carBody = carMats.map(m => Batch(boxG, m, world));
    const carCab = Batch(boxG, cabMat, world);
    const addCar = (x, z, ry) => {
      carBody[Math.floor(wr() * carBody.length)].add(x, .28, z, 1.8, .85, 4.4, ry);
      carCab.add(x, 1.1, z, 1.55, .7, 2.3, ry);
    };

    /* parked cars in both car parks */
    [[-260, -60], [-30, 160]].forEach(([za, zb]) => {
      for (let g = 0; g < 5; g++) {
        for (let z = za; z < zb; z += 2.7) {
          [5, 15].forEach(dx => { if (wr() < .62 / LOD) addCar(-540 + g * 20 + dx, z, Math.PI / 2); });
        }
      }
    });
    /* cars at the kerb and on the perimeter road */
    for (let i = 0; i < 14; i++) addCar(-396.5, rr(-250, 120), 0);

    /* ground-support equipment around the stands */
    const GSE = ['#d1a526', '#dcdcdc', '#c8631f', '#4d6478'].map(h => lam(h));
    const gseB = GSE.map(m => Batch(boxG, m, world));
    const gseTop = Batch(boxG, lam('#2b3138'), world);
    const dist2 = (x, z, cx, cz) => (x - cx) * (x - cx) + (z - cz) * (z - cz);

    for (let i = 0; i < 46 / LOD; i++) {
      const x = rr(-216, -124), z = rr(-270, 120);
      if (dist2(x, z, -168, -40) < 34 * 34 || dist2(x, z, -168, -145) < 34 * 34 || Math.abs(x + 130) < 5) continue;
      const k = Math.floor(wr() * 4), ry = wr() > .5 ? 0 : Math.PI / 2;
      if (k === 0) { gseB[0].add(x, 0, z, 2, 1.1, 3, ry); gseTop.add(x, 1.1, z, 1.6, .9, 1.3, ry); }       // tug
      else if (k === 1) gseB[1].add(x, 0, z, 2.5, 2.8, 7, ry);                                           // truck
      else if (k === 2) gseB[2].add(x, 0, z, 2.6, 2.3, 8.5, ry);                                         // fuel
      else for (let c = 0; c < 4; c++) gseB[3].add(x + (ry ? c * 3.4 : 0), 0, z + (ry ? 0 : c * 3.4), 1.8, 1, 3.1, ry); // cart train
    }

    /* a few vehicles that actually drive, so the airfield feels alive */
    const movers = [];
    const mkBox = (mat, sx, sy, sz, y) => { const m = put(boxG, mat, 0, y, 0, sx, sy, sz); return m; };
    const mkMover = (parts, x, z0, z1, v, ph) => {
      const g = new THREE.Group();
      parts.forEach(([mat, sx, sy, sz, y, oz]) => {
        const m = new THREE.Mesh(boxG, mat); m.scale.set(sx, sy, sz); m.position.set(0, y, oz || 0); g.add(m);
      });
      world.add(g);
      movers.push({ g, x, z0, z1, v, ph });
    };
    for (let i = 0; i < 9; i++) {
      const c = carMats[i % carMats.length];
      mkMover([[c, 1.8, .85, 4.4, .28, 0], [cabMat, 1.55, .7, 2.3, 1.1, 0]], 157.8, 300, -3900, rr(13, 22), rr(0, 4000));
      mkMover([[carMats[(i + 3) % carMats.length], 1.8, .85, 4.4, .28, 0], [cabMat, 1.55, .7, 2.3, 1.1, 0]], 162.2, -3900, 300, rr(13, 22), rr(0, 4000));
    }
    const mBus = lam('#e4e4e0'), mBusB = lam('#2a4f86');
    mkMover([[mBus, 2.6, 2.9, 11, .5, 0], [mBusB, 2.62, .6, 11.02, 1.0, 0]], -131, -290, 130, 5, 0);
    mkMover([[mBus, 2.6, 2.9, 11, .5, 0], [mBusB, 2.62, .6, 11.02, 1.0, 0]], -410, -380, 380, 7, 120);
    for (let k = 0; k < 2; k++) {
      mkMover([[GSE[0], 2, 1.1, 3, 0, 0], [gseTop.mat || cabMat, 1.6, .9, 1.3, 1.1, 0],
        [GSE[3], 1.8, 1, 3.1, 0, 4], [GSE[3], 1.8, 1, 3.1, 0, 7.4], [GSE[3], 1.8, 1, 3.1, 0, 10.8]],
        -126, -280, 120, 3.5, k * 60);
    }

    worldUpdate = function (tt) {
      for (let i = 0; i < movers.length; i++) {
        const m = movers[i];
        const len = Math.abs(m.z1 - m.z0);
        const s = (tt * m.v + m.ph) % len;
        const dir = m.z1 > m.z0 ? 1 : -1;
        m.g.position.set(m.x, 0, m.z0 + dir * s);
        m.g.rotation.y = dir > 0 ? 0 : Math.PI;
      }
    };

    /* ──────────────── service, cargo and ops compounds ──────────────── */

    const wallB = wallMats.map(m => Batch(boxG, m, world));
    const roofFlatB = roofMats.map(m => Batch(boxG, m, world));
    const gableB = roofMats.map(m => Batch(prismG, m, world));
    const barrelB = Batch(archG, mMetal, world);
    const hvacB = Batch(boxG, mConcD, world);
    const dockB = Batch(boxG, mDark, world);

    function building(x, z, w, d, h, face) {
      const s = Math.floor(wr() * wallB.length), k = Math.floor(wr() * roofMats.length);
      wallB[s].add(x, 0, z, w, h, d);
      const t = wr();
      if (t < .3) {
        roofFlatB[k].add(x, h, z, w + .6, .6, d + .6);
        for (let i = 0; i < 1 + Math.floor(wr() * 3); i++)
          hvacB.add(x + rr(-w / 3, w / 3), h + .6, z + rr(-d / 3, d / 3), rr(2, 5), rr(1, 2.5), rr(2, 5));
      } else if (t < .65) {
        const rg = rr(2.5, 5.5);
        if (w < d) gableB[k].add(x, h, z, w / 2 + .4, rg, d + .8);
        else gableB[k].add(x, h, z, d / 2 + .4, rg, w + .8, Math.PI / 2);
      } else {
        if (w < d) barrelB.add(x, h, z, w / 2, 3.2 / 1.45, d);
        else barrelB.add(x, h, z, d / 2, 3.2 / 1.45, w, Math.PI / 2);
      }
      const n = 1 + Math.floor(wr() * 3);
      for (let i = 0; i < n; i++) dockB.add(x + face * (w / 2 + .03), 0, z + (i - (n - 1) / 2) * 8, .25, 4.2, 5.2);
    }

    function zone(x0, x1, z0, z1, hMin, hMax, face) {
      let z = z0;
      while (z > z1) {
        const d = rr(28, 64);
        const cols = (x1 - x0) > 90 && wr() > .35 ? 2 : 1;
        const cw = (x1 - x0) / cols;
        for (let c = 0; c < cols; c++) {
          const w = rr(cw * .55, cw * .9);
          const x = x0 + cw * c + cw / 2 + rr(-(cw - w) / 2, (cw - w) / 2);
          building(x, z - d / 2, w, d, rr(hMin, hMax), face);
        }
        z -= d + rr(12, 26);
      }
    }

    zone(200, 330, 290, -1100, 7, 16, -1);        // right: cargo / warehouses (face the runway)
    zone(-562, -440, -390, -2200, 6, 17, 1);      // left: maintenance / ops / utility

    /* shipping containers, trucks and tanks in the compounds */
    const CONT = ['#8a4b3a', '#3d5f86', '#4f7a55', '#8a8f92'].map(h => lam(h));
    const contB = CONT.map(m => Batch(boxG, m, world));
    const truckB = Batch(boxG, lam('#e1e1dc'), world);
    for (let i = 0; i < 80 / LOD; i++) {
      const right = wr() > .5;
      const x = right ? rr(196, 326) : rr(-558, -444), z = right ? rr(280, -1090) : rr(-380, -2190);
      if (wr() > .35) { const ry = wr() > .5 ? 0 : Math.PI / 2; for (let s = 0; s < 1 + Math.floor(wr() * 3); s++) contB[Math.floor(wr() * 4)].add(x, s * 2.6, z, 2.45, 2.6, 6.1, ry); }
      else truckB.add(x, .4, z, 2.5, 3, 8, wr() > .5 ? 0 : Math.PI / 2);
    }

    const tankM = lam('#d9dcdc');
    const tankB = Batch(cylG, tankM, world);
    for (let i = 0; i < 6; i++) tankB.add(250 + (i % 3) * 24, 0, -2400 - Math.floor(i / 3) * 24, 9, 12, 9);
    Batch(boxG, mConcD, world).add(262, 0, -2412, 70, .8, 52);

    /* ──────────────── bushes and landside trees ──────────────── */

    const BUSH = ['#2f5a2c', '#3b6b32', '#47773a'].map(h => lam(h));
    const bushB = BUSH.map(m => Batch(bushG, m, world));
    const trunkB = Batch(cylG, lam('#4a3a2a'), world);
    const crownB = Batch(bushG, lam('#3f6e34'), world);
    const bush = (x, z) => { const r = rr(1.2, 2.5); bushB[Math.floor(wr() * 3)].add(x, r * .55, z, r, r * .75, r, wr() * 3); };

    for (let z = -420; z < 420; z += 7 * LOD) { bush(-421.5 + rr(-1, 1), z + rr(-2, 2)); bush(-396 + rr(-1, 1), z + rr(-2, 2)); }
    for (let z = 330; z > -4000; z -= 38 * LOD) bush(143 + rr(-2, 2), z + rr(-6, 6));
    for (let i = 0; i < 70 / LOD; i++) {
      const x = rr(-545, -425), z = rr(-280, 170);
      if (Math.abs(((x + 540) % 20) - 10) < 3.5) continue;
      const h = rr(3.5, 6), r = rr(2.2, 3.6);
      trunkB.add(x, 0, z, .28, h, .28);
      crownB.add(x, h + r * .5, z, r, r * .85, r);
    }

    /* ──────────────── build everything ──────────────── */

    const glowSpec = [
      ['blue', [.2, .36, 1], 1.1, .9], ['green', [.2, 1, .38], .8, .7],
      ['warm', [1, .8, .5], 2.4, .85], ['mast', [1, .86, .62], 5, .9],
      ['red', [1, .12, .1], 3.6, .95], ['white', [1, .95, .85], 1.5, .85]
    ];
    glowSpec.forEach(([k, col, size, a]) => { if (glows[k].length) staticGlow(glows[k], col, size, a); });

    /* ──────────────── distant city (hazy skyline, tiles along the flight path) ──────────────── */

    {
      const cr = rng(9091);
      const R2 = (a, b) => a + (b - a) * cr();

      const facs = [
        facadePair(128, 256, 8, 40, '#7f8c99', '#27384a', 41, .2),   // glass office towers
        facadePair(128, 256, 8, 30, '#a79f92', '#4a4540', 42, .14),  // apartment blocks
        facadePair(128, 256, 6, 16, '#8d8f8e', '#3b3f44', 43, .06)   // low-rise / industrial
      ];
      const tints = ['#cfd8e2', '#e0d6c4', '#c7c9c8'];
      const cmats = facs.map((f, i) => new THREE.MeshLambertMaterial({
        map: f.map, emissiveMap: f.em, emissive: 0xffffff, emissiveIntensity: .6, color: C(tints[i])
      }));

      const cw = cmats.map(m => Batch(boxG, m, city));
      const capB = Batch(boxG, mRoofD, city);
      const spireB = Batch(cylG, mMetal, city);
      const gB = Batch(prismG, lam('#6d7378'), city);
      const urbanB = Batch(boxG, lam('#5d6064'), city);

      const PERIODS = [-3, -2, -1, 0];
      const each = fn => PERIODS.forEach(p => fn(p * CITY_P));
      const wrapZ = z => ((z % CITY_P) + CITY_P) % CITY_P;

      const place = (x, z, w, d, h, kind) => {
        z = wrapZ(z);
        const a = cr(), b = cr(), c2 = R2(3, 7);
        each(off => {
          cw[kind].add(x, 0, z + off, w, h, d);
          if (kind === 0) {
            if (h > 120 && a > .35) {
              cw[0].add(x, h, z + off, w * .62, h * .14, d * .62);
              if (b > .4) spireB.add(x, h * 1.14, z + off, .9, h * .2, .9);
            } else if (a > .5) capB.add(x, h, z + off, w * .35, c2, d * .35);
          } else if (kind === 1) capB.add(x, h, z + off, w * .3, c2, d * .3);
          else if (a > .5) gB.add(x, h, z + off, w / 2 + .3, c2, d + .6);
          else capB.add(x, h, z + off, w * .3, c2 * .5, d * .3);
        });
      };

      [-1, 1].forEach(s => {
        for (let i = 0; i < 3; i++) {
          const cx = s * R2(2300, 3900);
          const cz = i * CITY_P / 3 + R2(0, CITY_P / 3);
          const rho = R2(420, 720);

          each(off => urbanB.add(cx, 0, wrapZ(cz) + off, rho * 1.7, .3, rho * 1.7));

          for (let gx = -rho; gx <= rho; gx += 70 * LOD) {
            for (let gz = -rho; gz <= rho; gz += 70 * LOD) {
              const d = Math.hypot(gx, gz) / rho;
              if (d > 1 || cr() > .92 - d * .45) continue;
              const x = cx + gx + R2(-12, 12), z = cz + gz + R2(-12, 12);
              if (d < .32 && cr() < .78) place(x, z, R2(30, 48), R2(30, 48), R2(90, 230) * (1 - d * .5), 0);
              else if (d < .7 && cr() < .75) place(x, z, R2(40, 70), R2(16, 26), R2(30, 75), 1);
              else place(x, z, R2(40, 100), R2(30, 70), R2(7, 22), 2);
            }
          }
        }
        /* suburban scatter between the airport and the centres */
        for (let i = 0; i < 90 / LOD; i++)
          place(s * R2(1300, 4800), R2(0, CITY_P), R2(30, 90), R2(25, 60), R2(6, 20), cr() > .8 ? 1 : 2);
      });
    }

    batches.forEach(b => b.build());

    /* static world: compute matrices once, never again */
    const dyn = new Set(movers.map(m => m.g));
    world.traverse(o => {
      if (dyn.has(o) || dyn.has(o.parent)) return;
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    city.children.forEach(o => { o.updateMatrix(); o.matrixAutoUpdate = false; });
  }

  /* ───────────── Trees ───────────── */

  /*
   * Procedural conifers + broadleaf trees in groves, drawn with a handful of
   * InstancedMeshes. The pattern repeats every TREE_P metres along Z and the
   * whole group is re-snapped to the aircraft each frame, so the forest
   * never runs out and never visibly jumps. Kept clear of the runway,
   * the airport/apron and the camera fly-by corridor.
   */

  const TREE_P = 1200;
  const trees = new THREE.Group();
  scene.add(trees);

  {
    const tr = rng(4242);
    const bands = [
      /* xMin, xMax, groves per period, bias toward the near edge */
      [340, 1100, mobile ? 14 : 24, 1],
      [-1250, -640, mobile ? 8 : 13, -1]
    ];

    const pat = [];

    bands.forEach(([x0, x1, n, dir]) => {

      for (let g = 0; g < n; g++) {

        const u = Math.pow(tr(), 1.5);
        const cx = dir > 0 ? x0 + (x1 - x0) * u : x1 - (x1 - x0) * u;
        const cz = tr() * TREE_P;
        const cnt = 7 + Math.floor(tr() * 9);
        const rad = 22 + tr() * 38;

        for (let i = 0; i < cnt; i++) {

          const a = tr() * Math.PI * 2;
          const d = Math.sqrt(tr()) * rad;
          let x = cx + Math.cos(a) * d;
          const z = cz + Math.sin(a) * d;

          x = dir > 0 ? Math.max(x, x0) : Math.min(x, x1);

          const broad = tr() > .72;
          const H = broad ? 10 + tr() * 9 : 14 + tr() * 17;

          pat.push({
            x,
            z,
            H,
            R: broad ? H * .4 : H * (.2 + tr() * .07),
            kind: broad ? 3 : Math.floor(tr() * 3),
            ry: tr() * 6.28
          });
        }
      }
    });

    const KS = 6;

    const foliageMats = [
      C('#2b5a2b'), C('#356b2f'), C('#234a2a'), C('#4f8236')
    ].map(c => new THREE.MeshLambertMaterial({ color: c }));

    const trunkMat = new THREE.MeshLambertMaterial({ color: C('#4a3a2a') });

    const coneG = new THREE.ConeGeometry(1, 1, 7);
    coneG.translate(0, .5, 0);

    const crownG = new THREE.IcosahedronGeometry(1, 1);

    const trunkG = new THREE.CylinderGeometry(.3, .5, 1, 5);
    trunkG.translate(0, .5, 0);

    const total = pat.length * KS;
    const byKind = [0, 1, 2, 3].map(k => pat.filter(t => t.kind === k));

    const mk = (geo, mat, n) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      m.frustumCulled = false;
      m.count = n;
      trees.add(m);
      return m;
    };

    const trunks = mk(trunkG, trunkMat, total);
    const o = new THREE.Object3D();
    let ti = 0;

    for (let k = 0; k < 4; k++) {

      const list = byKind[k];
      const n = list.length * KS;

      const A = mk(k === 3 ? crownG : coneG, foliageMats[k], n);
      const B = k === 3 ? null : mk(coneG, foliageMats[k], n);

      let i = 0;

      for (let p = -4; p < 2; p++) {
        list.forEach(t => {

          const x = t.x, z = t.z + p * TREE_P, H = t.H, R = t.R;
          const th = H * .2;

          o.rotation.set(0, t.ry, 0);

          o.position.set(x, 0, z);
          o.scale.set(1, th, 1);
          o.updateMatrix();
          trunks.setMatrixAt(ti++, o.matrix);

          if (k === 3) {
            o.position.set(x, th * .8 + R * .8, z);
            o.scale.set(R, R * .85, R);
            o.updateMatrix();
            A.setMatrixAt(i, o.matrix);
          } else {
            o.position.set(x, th * .7, z);
            o.scale.set(R, H * .62, R);
            o.updateMatrix();
            A.setMatrixAt(i, o.matrix);

            o.position.set(x, th * .7 + H * .28, z);
            o.scale.set(R * .68, H * .5, R * .68);
            o.updateMatrix();
            B.setMatrixAt(i, o.matrix);
          }

          i++;
        });
      }

      A.instanceMatrix.needsUpdate = true;
      if (B) B.instanceMatrix.needsUpdate = true;
    }

    trunks.count = ti;
    trunks.instanceMatrix.needsUpdate = true;

    trees.children.forEach(o => { o.updateMatrix(); o.matrixAutoUpdate = false; });
  }

  /* ───────────── Clouds ───────────── */

  const cloudTexs=[];

  for(let k=0;k<4;k++){

    cloudTexs.push(
      canvasTex(
        256,
        128,
        (ctx,w,h)=>{

          const g =
            ctx.createRadialGradient(
              w/2,
              h/2,
              0,
              w/2,
              h/2,
              w/2
            );

          g.addColorStop(
            0,
            'rgba(255,255,255,.95)'
          );

          g.addColorStop(
            .45,
            'rgba(255,255,255,.65)'
          );

          g.addColorStop(
            1,
            'rgba(255,255,255,0)'
          );

          ctx.fillStyle=g;

          ctx.fillRect(
            0,
            0,
            w,
            h
          );
        }
      )
    );
  }

  const clouds=[];
  const cloudGroup =
    new THREE.Group();

  scene.add(cloudGroup);

  const crng =
    rng(1234);

  const NC = mobile ? 95 : 175;

  const CWIN_AHEAD=3600;
  const CWIN_BEHIND=700;

  function placeCloud(c,z){

    const rx=crng()-.5;
    const corridor=crng()<.35;

    c.sprite.position.set(
      corridor
        ? rx*520
        : rx*3400,

      250+
      crng()*190+
      (crng()<.2
        ? crng()*160
        : 0),

      z
    );

    const w=
      260+
      crng()*520;

    c.w=w;

    c.sprite.scale.set(
      w,
      w*(.5+crng()*.25),
      1
    );

    c.base=
      .55+
      crng()*.4;

    c.sprite.material.rotation =
      (crng()-.5)*.08;
  }

  for(let i=0;i<NC;i++){

    const mat =
      new THREE.SpriteMaterial({
        map:cloudTexs[i%4],
        transparent:true,
        depthWrite:false,
        fog:true,
        color:new THREE.Color(
          1,
          .84+crng()*.07,
          .70+crng()*.12
        )
      });

    const c={
      sprite:new THREE.Sprite(mat),
      w:300,
      base:1
    };

    placeCloud(
      c,
      -CWIN_AHEAD+
      crng()*(CWIN_AHEAD+CWIN_BEHIND)
    );

    cloudGroup.add(
      c.sprite
    );

    clouds.push(c);
  }

  /* ───────────── Haze ───────────── */

  const hazeBanks =
    new THREE.Group();

  scene.add(hazeBanks);

  for(let i=0;i<14;i++){

    const mat =
      new THREE.SpriteMaterial({
        map:cloudTexs[i%4],
        transparent:true,
        depthWrite:false,
        fog:false,
        opacity:.3,
        color:new THREE.Color(
          1,
          .68,
          .42
        )
      });

    const s =
      new THREE.Sprite(mat);

    s.position.set(
      (i-7)*420+crng()*200,
      90+crng()*90,
      -3300-crng()*600
    );

    s.scale.set(
      1100+crng()*800,
      260+crng()*100,
      1
    );

    hazeBanks.add(s);
  }

  /* ───────────── God rays ───────────── */

  const shafts =
    new THREE.Group();

  scene.add(shafts);

  const shaftTex =
    canvasTex(
      64,
      256,
      (ctx,w,h)=>{

        const g =
          ctx.createLinearGradient(
            0,
            0,
            0,
            h
          );

        g.addColorStop(
          0,
          'rgba(255,220,160,0)'
        );

        g.addColorStop(
          .3,
          'rgba(255,220,160,.9)'
        );

        g.addColorStop(
          1,
          'rgba(255,220,160,0)'
        );

        ctx.fillStyle=g;
        ctx.fillRect(
          0,
          0,
          w,
          h
        );

        const g2 =
          ctx.createLinearGradient(
            0,
            0,
            w,
            0
          );

        g2.addColorStop(
          0,
          'rgba(0,0,0,1)'
        );

        g2.addColorStop(
          .5,
          'rgba(0,0,0,0)'
        );

        g2.addColorStop(
          1,
          'rgba(0,0,0,1)'
        );

        ctx.globalCompositeOperation =
          'destination-out';

        ctx.fillStyle=g2;

        ctx.fillRect(
          0,
          0,
          w,
          h
        );
      }
    );

  const shaftMats=[];

  {
    const down =
      sunDir.clone().negate();

    const q =
      new THREE.Quaternion()
        .setFromUnitVectors(
          new THREE.Vector3(0,1,0),
          down
        );

    const n =
      mobile
      ? 5
      : 9;

    for(let i=0;i<n;i++){

      const mat =
        new THREE.MeshBasicMaterial({
          map:shaftTex,
          transparent:true,
          opacity:0,
          depthWrite:false,
          blending:THREE.AdditiveBlending,
          fog:false,
          side:THREE.DoubleSide
        });

      shaftMats.push(mat);

      const px =
        (crng()-.5)*900;

      const pz =
        -300-crng()*800;

      const w=
        40+crng()*90;

      for(let k=0;k<2;k++){

        const m =
          new THREE.Mesh(
            new THREE.PlaneGeometry(
              w,
              900
            ),
            mat
          );

        m.quaternion.copy(q);
        m.rotateY(k*Math.PI/2);

        m.position.set(
          px,
          330,
          pz
        );

        shafts.add(m);
      }
    }
  }

  /* ───────────── Aircraft ───────────── */

  /* All livery colours are converted to linear (C) because they are used as
     vertex colours / material colours under sRGB output. */
  const WHITE =
    C('#f8fafc');

  const NAVY =
    C('#00508f');

  const DEEP =
    C('#003b70');

  const SILVER =
    C('#dfe6ed');

  const WING_LO =
    C('#b9c2cc');

  const WING_HI =
    C('#e4e9ef');

  const WCOL =
    new THREE.Color();

  const R=2.9;
  const NOSE_L=8;
  const TAIL_D=44;
  const GROUND_Y=4.4;

  function profileR(yl){

    const d=29-yl;

    if(d<=0)
      return .001;

    if(d<NOSE_L){

      const u=
        (NOSE_L-d)/NOSE_L;

      return R*
        Math.sqrt(
          Math.max(
            1-u*u,
            0
          )
        );
    }

    if(d<TAIL_D)
      return R;

    const u=
      (d-TAIL_D)/13;

    return u>=1
      ? .12
      : R*
        (1-.96*Math.pow(u,1.6));
  }

  function buildFuselage(){

    const ys=[];

    for(
      let y=-28;
      y<-15;
      y+=.4
    )
      ys.push(y);

    for(
      let y=-15;
      y<21;
      y+=1.5
    )
      ys.push(y);

    for(
      let i=0;
      i<=26;
      i++
    )
      ys.push(
        29-
        NOSE_L*
        (1-
        Math.sin(
          i/26*Math.PI/2
        ))
      );

    ys.sort(
      (a,b)=>a-b
    );

    const pts =
      ys
      .filter(
        (y,i)=>
          i===0 ||
          y-ys[i-1]>1e-4
      )
      .map(
        y=>
          new THREE.Vector2(
            profileR(y),
            y
          )
      );

    const g =
      new THREE.LatheGeometry(
        pts,
        112
      );

    g.rotateX(
      -Math.PI/2
    );

    const pos =
      g.attributes.position;

    const col =
      new Float32Array(
        pos.count*3
      );

    const c =
      new THREE.Color();

    for(
      let i=0;
      i<pos.count;
      i++
    ){

      const x=pos.getX(i);
      const y=pos.getY(i);
      const z=pos.getZ(i);

      /*
       * Boeing-inspired commercial livery:
       * bright white fuselage,
       * blue belly,
       * blue rear section,
       * blue accent stripe.
       */

      c.copy(WHITE);

      /* faint grey roll-off toward the keel so the white has form */
      c.lerp(
        SILVER,
        sm(-0.6,-2.4,y)*.35
      );

      /* deep-blue belly: solid below y=-1.3, crisp edge up to y=-1.0 */
      const blueBelly =
        1-sm(-1.3,-1.0,y);

      c.lerp(
        NAVY,
        blueBelly
      );

      /* blue rear fuselage / tail cone */
      c.lerp(
        DEEP,
        sm(16.5,21.0,z)
      );

      /* accent cheat-line above the window row */
      const stripe =
        (1-sm(.05,.13,Math.abs(y-1.05)))*
        sm(-18.0,-15.5,z)*
        (1-sm(15.5,17.0,z));

      c.lerp(
        NAVY,
        stripe
      );

      col[i*3]=c.r;
      col[i*3+1]=c.g;
      col[i*3+2]=c.b;

      if(z>12)
        pos.setY(
          i,
          y+
          Math.pow(
            (z-12)/16,
            2
          )*1.8
        );
    }

    g.setAttribute(
      'color',
      new THREE.BufferAttribute(
        col,
        3
      )
    );

    return g;
  }

  /*
   /*
   * MATERIAL PIPELINE FIX.
   *
   * Diagnosis: the livery vertex colours were fine (linear, non-zero,
   * `vertexColors:true` is the correct r128 form). The black came from the
   * lighting side: the aircraft used Standard/Physical (PBR) materials,
   * whose result depends on scene.environment, and that environment map was
   * corrupt (see the PMREM note above). In addition, the flap boxes shared
   * the vertex-coloured wing material although BoxGeometry has no `color`
   * attribute, which WebGL reads as black.
   *
   * The painted surfaces now use MeshPhongMaterial:
   *   - still fully lit: sun, hemisphere, fill and bounce lights, cast and
   *     receive shadows, specular highlights;
   *   - independent of scene.environment, so the livery cannot go black if
   *     the IBL ever fails;
   *   - a tiny blue emissive floor keeps the shaded side readable against
   *     bright clouds.
   * Nothing is unlit; the rest of the scene keeps its PBR materials.
   */

  const LIFT = 0x0a1522;

  const paint =
    (hex,extra)=>
      new THREE.MeshPhongMaterial(
        Object.assign({
          color:C(hex),
          specular:0x3a444f,
          shininess:70,
          emissive:LIFT
        },extra||{})
      );

  const bodyMat =
    new THREE.MeshPhongMaterial({
      vertexColors:true,
      color:new THREE.Color(.94,.94,.96),
      specular:0x3a444f,
      shininess:60,
      emissive:LIFT,
      side:THREE.DoubleSide
    });

  const wingMat =
    new THREE.MeshPhongMaterial({
      vertexColors:true,
      specular:0x333b44,
      shininess:45,
      emissive:LIFT,
      side:THREE.DoubleSide
    });

  /* flaps are plain boxes (no colour attribute) so they must not use
     a vertexColors material */
  const flapMat =
    paint(
      '#c6cfd9',
      {
        shininess:45,
        side:THREE.DoubleSide
      }
    );

  const ringMat =
    paint(
      '#0a63ad',
      {
        shininess:90
      }
    );

  const glassMat =
    new THREE.MeshPhysicalMaterial({
      color:0x070d16,
      roughness:.05,
      metalness:.9,
      clearcoat:1,
      clearcoatRoughness:.03,
      envMapIntensity:1.6,
      polygonOffset:true,
      polygonOffsetFactor:-2,
      polygonOffsetUnits:-2
    });

  const metalMat =
    new THREE.MeshPhongMaterial({
      color:C('#9aa3ad'),
      specular:0xb8c2cc,
      shininess:80,
      emissive:0x06090d
    });

  const darkMat =
    new THREE.MeshStandardMaterial({
      color:0x0d1014,
      roughness:.75,
      metalness:.2,
      side:THREE.DoubleSide
    });

  const tireMat =
    new THREE.MeshStandardMaterial({
      color:0x15171a,
      roughness:.95
    });

  const glowTex =
    canvasTex(
      64,
      64,
      (ctx,w,h)=>{

        const g =
          ctx.createRadialGradient(
            32,
            32,
            0,
            32,
            32,
            32
          );

        g.addColorStop(
          0,
          'rgba(255,255,255,1)'
        );

        g.addColorStop(
          .25,
          'rgba(255,255,255,.55)'
        );

        g.addColorStop(
          1,
          'rgba(255,255,255,0)'
        );

        ctx.fillStyle=g;

        ctx.fillRect(
          0,
          0,
          w,
          h
        );
      }
    );

  const finLogo =
    canvasTex(
      1024,
      256,
      (ctx,w,h)=>{

        ctx.clearRect(
          0,
          0,
          w,
          h
        );

        ctx.fillStyle =
          '#ffffff';

        ctx.font =
          '800 150px Sora, "Arial Black", sans-serif';

        ctx.textAlign =
          'center';

        ctx.textBaseline =
          'middle';

        if(
          ctx.letterSpacing !==
          undefined
        )
          ctx.letterSpacing='14px';

        ctx.fillText(
          'BOEING',
          w/2,
          h/2+6
        );
      }
    );

  /* ───────────── Wing geometry ───────────── */

  function Wing(o){

    const K=14;
    const N=o.N||18;
    const rc=2*K;

    const sx=o.side;

    const nV=
      (N+1)*rc;

    const pos =
      new Float32Array(
        (nV+rc+1)*3
      );

    const col =
      new Float32Array(
        (nV+rc+1)*3
      );

    const idx=[];

    function yc(f,flex){

      return o.y0+
        Math.sin(f*Math.PI/2)*
        o.dih+
        flex*.12*f;
    }

    function zle(f){

      return o.zLE0+
        o.S*f*
        Math.tan(o.sweep);
    }

    function chord(f){

      return o.c0+
        (o.c1-o.c0)*f;
    }

    for(
      let i=0;
      i<=N;
      i++
    ){

      const f=i/N;

      const y=yc(f,0);
      const z=zle(f);
      const ch=chord(f);

      for(
        let j=0;
        j<rc;
        j++
      ){

        const a=
          j/(rc-1);

        const x=
          sx*
          (o.x0+
          o.S*f);

        const zz=
          z+
          (a-.5)*ch;

        const k=
          i*rc+j;

        pos[k*3]=x;
        pos[k*3+1]=y;
        pos[k*3+2]=zz;

        /* light silver-grey: slightly darker at the leading edge and
           toward the wing root, brighter toward the trailing edge */
        WCOL.copy(WING_LO).lerp(
          WING_HI,
          sm(0,1,a)
        );

        WCOL.multiplyScalar(
          .8+.2*sm(0,.16,f)
        );

        col[k*3]=WCOL.r;
        col[k*3+1]=WCOL.g;
        col[k*3+2]=WCOL.b;
      }
    }

    for(
      let i=0;
      i<N;
      i++
    ){

      for(
        let j=0;
        j<rc-1;
        j++
      ){

        const a=
          i*rc+j;

        const b=
          a+1;

        const c=
          (i+1)*rc+j;

        const d=
          c+1;

        idx.push(
          a,b,c,
          b,d,c
        );
      }
    }

    const g=
      new THREE.BufferGeometry();

    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        pos,
        3
      )
    );

    g.setAttribute(
      'color',
      new THREE.BufferAttribute(
        col,
        3
      )
    );

    g.setIndex(idx);

    g.computeVertexNormals();

    return {
      geo:g,
      side:sx,
      yc,
      zle,
      chord,

      update(flex){

        const p=
          g.attributes.position;

        for(
          let i=0;
          i<=N;
          i++
        ){

          const f=i/N;

          for(
            let j=0;
            j<rc;
            j++
          ){

            const a=
              j/(rc-1);

            const k=
              i*rc+j;

            p.setY(
              k,
              yc(f,flex)
            );
          }
        }

        p.needsUpdate=true;

        g.computeVertexNormals();
      }
    };
  }

  /* ───────────── Aircraft ───────────── */

  function buildAircraft(){

    const A={
      fans:[],
      wheels:[],
      flaps:[],
      wings:[],
      lights:[]
    };

    const model =
      new THREE.Group();

    A.model=model;

    const add =
      (m,parent)=>{
        m.castShadow=true;
        m.receiveShadow=true;

        (parent||model).add(m);

        return m;
      };

    add(
      new THREE.Mesh(
        buildFuselage(),
        bodyMat
      )
    );

    /* ALTITUDE wordmark */

   const fuselageLogo =
  canvasTex(
    900,
    180,
    (ctx, w, h) => {

      ctx.clearRect(0, 0, w, h);

      const text = 'GROUND SUPPORT';

      ctx.fillStyle = '#005b9a';

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Maximum and minimum font sizes
      const maxFontSize = 118;
      const minFontSize = 35;

      let fontSize = maxFontSize;

      // Leave some padding on both sides
      const maxWidth = w * 0.92;

      // Automatically shrink the text until it fits
      while (fontSize > minFontSize) {

        ctx.font =
          `800 ${fontSize}px Arial, sans-serif`;

        if (ctx.measureText(text).width <= maxWidth) {
          break;
        }

        fontSize -= 2;
      }

      ctx.font =
        `800 ${fontSize}px Arial, sans-serif`;

      ctx.fillText(
        text,
        w / 2,
        h / 2 + 4
      );
    }
  );
    [-1,1].forEach(s=>{

      const logo =
        new THREE.Mesh(
          new THREE.PlaneGeometry(
            8.2,
            1.55
          ),
          new THREE.MeshBasicMaterial({
            map:fuselageLogo,
            transparent:true,
            toneMapped:false,
            depthWrite:false
          })
        );

      logo.position.set(
        s*2.915,
        -.3,
        .4
      );

      logo.rotation.y =
        s*Math.PI/2;

      model.add(logo);
    });

    /*
     * Cockpit windshield and side windows.
     *
     * The old pane helper produced degenerate (zero-area) triangles at the
     * wrong end of the aircraft, so no cockpit was ever drawn. These panes
     * are curved patches generated directly on the real nose profile:
     * a = angle around the fuselage measured from the top, z = along it
     * (nose is at -Z).
     */
    {
      const cockpitGlass = new THREE.MeshPhongMaterial({
        color: 0x0b1520,
        specular: 0xcfe0f0,
        shininess: 140,
        emissive: 0x060b11,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
      });

      const frameMat = paint('#1c242c', { side: THREE.DoubleSide });

      const patch = (z0, z1, a0, a1, lift, mat) => {
        const NZ = 8, NA = 6;
        const pos = [], idx = [];

        for (let i = 0; i <= NZ; i++) {
          const z = z0 + (z1 - z0) * i / NZ;
          const r = profileR(-z) + lift;

          for (let j = 0; j <= NA; j++) {
            const an = a0 + (a1 - a0) * j / NA;
            pos.push(Math.sin(an) * r, Math.cos(an) * r, z);
          }
        }

        for (let i = 0; i < NZ; i++) {
          for (let j = 0; j < NA; j++) {
            const p = i * (NA + 1) + j;
            idx.push(p, p + 1, p + NA + 1, p + 1, p + NA + 2, p + NA + 1);
          }
        }

        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
        g.setIndex(idx);
        g.computeVertexNormals();

        return add(new THREE.Mesh(g, mat));
      };

      /* [z0, z1, angle0, angle1]: front windshield pair + two side windows per side */
      [[-26.3, -23.9, .13, .80],
       [-23.6, -22.0, .92, 1.36],
       [-21.7, -20.5, .95, 1.34]].forEach(([z0, z1, a0, a1]) =>
        [-1, 1].forEach(s => {
          const lo = s > 0 ? a0 : -a1;
          const hi = s > 0 ? a1 : -a0;

          patch(z0 - .12, z1 + .12, lo - .05, hi + .05, .014, frameMat);
          patch(z0, z1, lo, hi, .028, cockpitGlass);
        })
      );
    }

    /* wing-body fairing */

    const fair =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          1,
          32,
          16
        ),
        paint('#dfe4ea')
      );

    fair.scale.set(
      6.6,
      1.15,
      7.4
    );

    fair.position.set(
      0,
      -1.75,
      .6
    );

    add(fair);

    /* windows */

    {
      const n=46;

      const wm =
        new THREE.InstancedMesh(
          new THREE.BoxGeometry(
            .1,
            .4,
            .27
          ),
          new THREE.MeshStandardMaterial({
            color:0x0b121b,
            roughness:.1,
            metalness:.7,
            emissive:0x4a3418,
            emissiveIntensity:.35
          }),
          n*2
        );

      const o =
        new THREE.Object3D();

      const up =
        new THREE.Vector3(
          1,
          0,
          0
        );

      let k=0;

      const wy=.55;
      const wx=
        Math.sqrt(
          R*R-wy*wy
        );

      for(
        let s=-1;
        s<=1;
        s+=2
      )
      for(
        let i=0;
        i<n;
        i++
      ){

        const z=
          -19.4+
          i*.76;

        if(
          Math.abs(z+8)<.7 ||
          Math.abs(z+18.2)<.8 ||
          Math.abs(z-6)<.7 ||
          Math.abs(z-13)<.7
        ){

          o.scale.set(
            0,
            0,
            0
          );

        }else{

          o.scale.set(
            1,
            1,
            1
          );
        }

        o.position.set(
          s*wx,
          wy,
          z
        );

        o.quaternion.setFromUnitVectors(
          up,
          new THREE.Vector3(
            s*wx,
            wy,
            0
          ).normalize()
        );

        o.updateMatrix();

        wm.setMatrixAt(
          k++,
          o.matrix
        );
      }

      model.add(wm);

      const dm =
        paint(
          '#dde3ea',
          {
            polygonOffset:true,
            polygonOffsetFactor:-1
          }
        );

      [-18.2,-8,6,13]
        .forEach((z,i)=>
          [-1,1].forEach(s=>{

            const d =
              new THREE.Mesh(
                new THREE.BoxGeometry(
                  .05,
                  2.1,
                  i%3===0
                    ? .95
                    : 1.4
                ),
                dm
              );

            d.position.set(
              s*(R-.01),
              -.15,
              z
            );

            model.add(d);
          })
        );
    }

    /* wings */

    const wp={
      x0:2.0,
      S:28,
      c0:12,
      c1:1.9,
      zLE0:-6,
      sweep:32*Math.PI/180,
      dih:5*Math.PI/180,
      y0:-1.1,
      th0:.12,
      th1:.085,
      rake:2.5,
      N:20
    };

    [-1,1].forEach(s=>{

      const w =
        Wing(
          Object.assign(
            {side:s},
            wp
          )
        );

      w.side=s;

      add(
        new THREE.Mesh(
          w.geo,
          wingMat
        )
      ).frustumCulled=false;

      A.wings.push(w);
    });

    A.wp=wp;

    const sp={
      x0:.4,
      S:9.6,
      c0:5.8,
      c1:1.7,
      zLE0:18.8,
      sweep:34*Math.PI/180,
      dih:4*Math.PI/180,
      y0:1.15,
      th0:.09,
      th1:.07,
      N:8
    };

    [-1,1].forEach(s=>{

      const w=
        Wing(
          Object.assign(
            {side:s},
            sp
          )
        );

      add(
        new THREE.Mesh(
          w.geo,
          wingMat
        )
      ).frustumCulled=false;
    });

    /* flaps */

    const teK =
      (
        (
          wp.zLE0+
          wp.S*
          Math.tan(wp.sweep)+
          wp.c1
        )-
        (
          wp.zLE0+
          wp.c0
        )
      )/wp.S;

    [[.06,.27,.8],
     [.31,.6,.8],
     [.64,.9,.82]]
      .forEach(
        ([f0,f1,hinge])=>
          [-1,1].forEach(s=>{

            const fm=
              (f0+f1)/2;

            const hg=
              new THREE.Group();

            const df=
              new THREE.Mesh(
                new THREE.BoxGeometry(
                  .08,
                  .16,
                  wp.S*
                  (f1-f0)
                ),
                flapMat
              );

            df.position.set(
              0,
              0,
              0
            );

            hg.add(df);

            model.add(hg);

            A.flaps.push({
              s,
              fm,
              hg,
              df,
              hinge
            });
          })
      );

    /* horizontal stabilisers */

    const tailWing={
      x0:.5,
      S:9.5,
      c0:5.5,
      c1:1.5,
      zLE0:18.5,
      sweep:34*Math.PI/180,
      dih:4*Math.PI/180,
      y0:1.1,
      th0:.09,
      th1:.07,
      N:8
    };

    /* vertical fin */

    {
      const sh =
        new THREE.Shape();

      sh.moveTo(
        15.2,
        0
      );

      sh.lineTo(
        27.4,
        0
      );

      sh.lineTo(
        28.6,
        11.6
      );

      sh.lineTo(
        23.7,
        11.6
      );

      sh.lineTo(
        15.2,
        0
      );

      const g =
        new THREE.ExtrudeGeometry(
          sh,
          {
            depth:.44,
            bevelEnabled:true,
            bevelThickness:.08,
            bevelSize:.08,
            bevelSegments:2
          }
        );

      g.translate(
        0,
        0,
        -.22
      );

      const fin =
        new THREE.Mesh(
          g,
          paint('#003b70')
        );

      fin.rotation.y =
        -Math.PI/2;

      fin.position.y=.9;

      add(fin);

      [-1,1].forEach(s=>{

        const d =
          new THREE.Mesh(
            new THREE.PlaneGeometry(
              6.6,
              1.65
            ),
            new THREE.MeshBasicMaterial({
              map:finLogo,
              transparent:true,
              polygonOffset:true,
              polygonOffsetFactor:-4,
              toneMapped:false
            })
          );

        d.position.set(
          s*.33,
          5.5,
          22.6
        );

        d.rotation.y =
          s*Math.PI/2;

        d.rotation.z=0;

        model.add(d);
      });
    }

    /* engines */

    A.exhaust=[];

    [-1,1].forEach(s=>{

      const eg =
        new THREE.Group();

      const fe =
        (10.5-wp.x0)/wp.S;

      eg.position.set(
        s*10.5,
        -2.15,
        -.9
      );

      model.add(eg);

      A.eng=A.eng||[];
      A.eng.push(eg);

      const outer=[
        [.95,-3.3],
        [1.1,-2.7],
        [1.3,-1.7],
        [1.45,-.6],
        [1.52,.6],
        [1.5,1.8],
        [1.43,2.7],
        [1.36,3.02],
        [1.31,3.06]
      ].map(
        p=>new THREE.Vector2(
          p[0],
          p[1]
        )
      );

      let g =
        new THREE.LatheGeometry(
          outer,
          56
        );

      g.rotateX(
        -Math.PI/2
      );

      add(
        new THREE.Mesh(
          g,
          paint(
            '#d9e0e8',
            {
              side:THREE.DoubleSide
            }
          )
        ),
        eg
      );

      const inner=[
        [1.31,3.06],
        [1.24,2.9],
        [1.2,2.4],
        [1.17,1.2],
        [1.05,-.5],
        [.9,-2.8]
      ].map(
        p=>new THREE.Vector2(
          p[0],
          p[1]
        )
      );

      g=
        new THREE.LatheGeometry(
          inner,
          48
        );

      g.rotateX(
        -Math.PI/2
      );

      add(
        new THREE.Mesh(
          g,
          new THREE.MeshStandardMaterial({
            color:0x3a3f46,
            roughness:.5,
            metalness:.6,
            side:THREE.DoubleSide
          })
        ),
        eg
      );

      /* blue accent rings: inlet lip, forward band, exhaust cowl */
      [
        [1.375,.07,-2.96],
        [1.46,.085,-2.3],
        [1.08,.06,2.85]
      ].forEach(
        ([rr,tr,zz])=>{

          const ring =
            new THREE.Mesh(
              new THREE.TorusGeometry(
                rr,
                tr,
                10,
                64
              ),
              ringMat
            );

          ring.position.z=zz;

          ring.castShadow=true;

          eg.add(ring);
        }
      );

      const disc =
        new THREE.Mesh(
          new THREE.CircleGeometry(
            1.18,
            32
          ),
          new THREE.MeshStandardMaterial({
            color:0x07090b,
            roughness:.8,
            side:THREE.DoubleSide
          })
        );

      disc.position.z=-1.2;

      eg.add(disc);

      const fan =
        new THREE.Group();

      fan.position.z=-1.45;

      eg.add(fan);

      const bg=
        new THREE.BoxGeometry(
          .05,
          .9,
          .17
        );

      for(let i=0;i<22;i++){

        const bh=
          new THREE.Group();

        bh.rotation.z=
          i/22*Math.PI*2;

        const b=
          new THREE.Mesh(
            bg,
            metalMat
          );

        b.position.y=.72;
        b.rotation.y=.6;

        bh.add(b);
        fan.add(bh);
      }

      const spin=
        new THREE.Mesh(
          new THREE.ConeGeometry(
            .3,
            .85,
            24
          ),
          metalMat
        );

      spin.geometry.rotateX(
        -Math.PI/2
      );

      spin.position.z=-.4;

      fan.add(spin);

      A.fans.push(fan);

      const cone=
        new THREE.Mesh(
          new THREE.ConeGeometry(
            .56,
            2.6,
            24
          ),
          new THREE.MeshStandardMaterial({
            color:0x4a4f55,
            roughness:.4,
            metalness:.85
          })
        );

      cone.geometry.rotateX(
        Math.PI/2
      );

      cone.position.z=3.3;

      eg.add(cone);

      const py=
        add(
          new THREE.Mesh(
            new THREE.BoxGeometry(
              .5,
              1.5,
              5.6
            ),
            paint('#dce2e9')
          ),
          eg
        );

      py.position.set(
        0,
        1.2,
        .95
      );

      A.exhaust.push(eg);
    });

    /* landing gear */

    function wheel(r,w){

      const g=
        new THREE.Group();

      const t=
        new THREE.Mesh(
          new THREE.CylinderGeometry(
            r,
            r,
            w,
            28
          ),
          tireMat
        );

      t.geometry.rotateZ(
        Math.PI/2
      );

      t.castShadow=true;

      g.add(t);

      const h=
        new THREE.Mesh(
          new THREE.CylinderGeometry(
            r*.55,
            r*.55,
            w+.02,
            20
          ),
          metalMat
        );

      h.geometry.rotateZ(
        Math.PI/2
      );

      g.add(h);

      A.wheels.push(g);

      return g;
    }

    function strut(len,rad){

      const m=
        new THREE.Mesh(
          new THREE.CylinderGeometry(
            rad,
            rad*.8,
            len,
            12
          ),
          metalMat
        );

      m.position.y=
        -len/2;

      m.castShadow=true;

      return m;
    }

    const nose =
      new THREE.Group();

    nose.position.set(
      0,
      -2.4,
      -21
    );

    nose.add(
      strut(
        1.6,
        .13
      )
    );

    [-1,1].forEach(s=>{

      const w=
        wheel(
          .45,
          .26
        );

      w.position.set(
        s*.3,
        -1.95,
        0
      );

      nose.add(w);
    });

    model.add(nose);
    A.nose=nose;

    A.main=
      [-1,1].map(s=>{

        const m=
          new THREE.Group();

        m.position.set(
          s*5.4,
          -1.5,
          1.6
        );

        m.add(
          strut(
            2.2,
            .17
          )
        );

        const bog=
          new THREE.Mesh(
            new THREE.BoxGeometry(
              .2,
              .2,
              2.4
            ),
            metalMat
          );

        bog.position.y=
          -2.25;

        m.add(bog);

        [-1,0,1].forEach(a=>
          [-1,1].forEach(b=>{

            const w=
              wheel(
                .58,
                .4
              );

            w.position.set(
              b*.34,
              -2.25,
              a*1.05
            );

            m.add(w);
          })
        );

        const br=
          new THREE.Mesh(
            new THREE.CylinderGeometry(
              .06,
              .06,
              2.4,
              8
            ),
            metalMat
          );

        br.position.set(
          -s*.55,
          -1.1,
          .2
        );

        br.rotation.z=
          s*.4;

        m.add(br);

        model.add(m);

        return m;
      });

    /* lights */

    const mkLight =
      (c,x,y,z,size)=>{

        const s=
          new THREE.Sprite(
            new THREE.SpriteMaterial({
              map:glowTex,
              color:c,
              blending:
                THREE.AdditiveBlending,
              transparent:true,
              depthWrite:false,
              fog:false
            })
          );

        s.scale.set(
          size,
          size,
          1
        );

        s.position.set(
          x,
          y,
          z
        );

        model.add(s);

        return s;
      };

    A.navL=
      mkLight(
        0xff2a2a,
        -29.8,
        4,
        12.3,
        1.8
      );

    A.navR=
      mkLight(
        0x2aff66,
        29.8,
        4,
        12.3,
        1.8
      );

    A.strobeL=
      mkLight(
        0xffffff,
        -29.8,
        4,
        13.2,
        4
      );

    A.strobeR=
      mkLight(
        0xffffff,
        29.8,
        4,
        13.2,
        4
      );

    A.tail=
      mkLight(
        0xffffff,
        0,
        12.5,
        28.5,
        1.6
      );

    A.beacon=
      mkLight(
        0xff2020,
        0,
        3,
        2,
        2.4
      );

    A.spots=
      [-1,1].map(s=>{

        const sp=
          new THREE.SpotLight(
            0xfff0d8,
            0,
            600,
            .32,
            .7,
            1.2
          );

        sp.position.set(
          s*3.6,
          -1.9,
          -4.5
        );

        sp.target.position.set(
          s*2,
          -3.5,
          -200
        );

        model.add(
          sp,
          sp.target
        );

        A.lights.push(
          mkLight(
            0xfff0d8,
            s*3.6,
            -1.9,
            -5,
            3
          )
        );

        return sp;
      });

    return A;
  }

  /* ───────────── Pane helper ───────────── */

  function paneGeo(a,b,r0,r1){

    const pts=[];

    for(
      let i=0;
      i<12;
      i++
    ){

      const z=
        a+
        (b-a)*i/11;

      pts.push(
        new THREE.Vector3(
          Math.sqrt(
            Math.max(
              0,
              R*R-.55*.55
            )
          ),
          .55,
          z
        )
      );
    }

    const g=
      new THREE.BufferGeometry();

    const p=[];

    for(
      let i=0;
      i<pts.length-1;
      i++
    ){

      p.push(
        pts[i].x,
        pts[i].y,
        pts[i].z,

        pts[i+1].x,
        pts[i+1].y,
        pts[i+1].z
      );
    }

    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array(p),
        3
      )
    );

    return new THREE.LineSegments(
      g,
      glassMat
    ).geometry;
  }

  const plane =
    buildAircraft();

  /* two runway spot-lights are a luxury on phones: every lit pixel pays for them */


  const pivot =
    new THREE.Group();

  pivot.add(
    plane.model
  );

  plane.model.position.set(
    0,
    GROUND_Y,
    -1.6
  );

  scene.add(pivot);

  /* parked aircraft */

  [
    [-168,-40,-.95],
    [-168,-145,-.6]
  ].forEach(
    ([x,z,ry])=>{

      const c=
        plane.model.clone(true);

      const deadLights=[];
      c.traverse(o=>{ if(o.isSpotLight) deadLights.push(o); });
      deadLights.forEach(o=>{ if(o.parent) o.parent.remove(o); });

      const p=
        new THREE.Group();

      p.add(c);

      c.position.set(
        0,
        GROUND_Y,
        0
      );

      p.position.set(
        x,
        0,
        z
      );

      p.rotation.y=ry;

      scene.add(p);
    }
  );

  /* ───────────── Exhaust ───────────── */

  const EXN=70;

  const exhaust=
    makeGlow(
      EXN*2
    );

  scene.add(exhaust);

  const ex={
    age:new Float32Array(
      EXN*2
    ).fill(9),

    vel:new Float32Array(
      EXN*2*3
    ),

    head:0
  };

  function updateFlaps(
    flex,
    defl
  ){

    const wp=
      plane.wp;

    const w=
      plane.wings;

    plane.flaps.forEach(f=>{

      const wing=
        w[
          f.s>0
          ? 1
          : 0
        ];

      const fm=f.fm;

      if(f.fair){

        f.fair.position.set(
          f.s*
          (wp.x0+
          wp.S*fm),

          wing.yc(
            fm,
            flex
          )-.85,

          wing.zle(fm)+
          wing.chord(fm)*.78
        );

        return;
      }

      f.hg.position.set(
        f.s*
        (wp.x0+
        wp.S*fm),

        wing.yc(
          fm,
          flex
        ),

        wing.zle(fm)+
        wing.chord(fm)*
        f.hinge
      );

      f.df.rotation.x=
        defl*
        (
          f.fm>.6
          ? .6
          : 1
        );
    });
  }

  /* ───────────── Trajectory ───────────── */

  const T_ROLL=5;
  const T_ROT=16;
  const T_LIFT=17.2;
  const TAB_N=420*30;

  const traj={
    z:new Float32Array(TAB_N),
    alt:new Float32Array(TAB_N),
    v:new Float32Array(TAB_N),
    pitch:new Float32Array(TAB_N)
  };

  (function(){

    let z=0;
    let alt=0;

    const dt=1/30;

    for(
      let i=0;
      i<TAB_N;
      i++
    ){

      const T=i*dt;

      const v=
        T<T_ROLL
        ? 0
        : T<T_ROT
          ? 7.5*(T-T_ROLL)
          : Math.min(
              140,
              82.5+
              2.2*(T-T_ROT)
            );

      const vy=
        T<T_LIFT
        ? 0
        : 9+
          7*
          sm(
            T_LIFT,
            30,
            T
          );

      z+=v*dt;
      alt+=vy*dt;

      traj.z[i]=-z;   /* nose points -Z: travel toward -Z */
      traj.alt[i]=
        Math.max(
          0,
          alt
        );

      traj.v[i]=v;

      traj.pitch[i]=
        T<T_LIFT
        ? sm(
            T_ROT,
            T_LIFT,
            T
          )*.12
        : .12*
          (1-
            sm(
              T_LIFT,
              30,
              T
            )
          );
    }
  })();

  function sampleTraj(T){

    const i=
      Math.min(
        TAB_N-1,
        Math.max(
          0,
          Math.floor(
            T*30
          )
        )
      );

    return {
      z:traj.z[i],
      alt:traj.alt[i],
      v:traj.v[i],
      pitch:traj.pitch[i]
    };
  }

  /* ───────────── Camera ───────────── */

  const KEYS=[

    {
      t:0,
      p:[0,9,-38],
      l:[0,4,-2],
      f:50,
      ky:0
    },

    {
      t:5,
      p:[32,10,-32],
      l:[0,4,0],
      f:46,
      ky:.1
    },

    {
      t:10,
      p:[52,12,-42],
      l:[0,4.5,4],
      f:50,
      ky:0
    },

    {
      t:18.5,
      p:[74,4,-6],
      l:[0,6,-2],
      f:38,
      ky:.15
    },

    {
      t:21.5,
      p:[82,9,28],
      l:[0,5,-3],
      f:36,
      ky:.7
    },

    {
      t:24,
      p:[78,16,56],
      l:[0,3,-6],
      f:40,
      ky:1
    },

    {
      t:28,
      p:[40,20,-86],
      l:[0,3,-2],
      f:42,
      ky:1
    },

    {
      t:32,
      p:[-70,12,-72],
      l:[0,3,-2],
      f:44,
      ky:1
    },

    {
      t:36,
      p:[-95,22,16],
      l:[0,4,-2],
      f:40,
      ky:1
    },

    {
      t:40,
      p:[-60,26,118],
      l:[-6,4,-20],
      f:38,
      ky:1
    },

    {
      t:46,
      p:[-58,16,190],
      l:[-22,6,-45],
      f:40,
      ky:1
    }
  ];

  function crv(
    field,
    i,
    comp,
    t
  ){

    const n=
      KEYS.length;

    const v=
      k=>{
        k=
          Math.max(
            0,
            Math.min(
              n-1,
              k
            )
          );

        const x=
          KEYS[k][field];

        return comp===undefined
          ? x
          : x[comp];
      };

    const k0=KEYS[i];
    const k1=KEYS[i+1];

    const dt=
      k1.t-k0.t;

    const u=
      (t-k0.t)/dt;

    const tan=
      k=>{

        const a=
          Math.max(
            0,
            k-1
          );

        const b=
          Math.min(
            n-1,
            k+1
          );

        return b===a
          ? 0
          :
            (
              v(b)-v(a)
            )/
            (
              KEYS[b].t-
              KEYS[a].t
            );
      };

    const m0=
      tan(i)*dt;

    const m1=
      tan(i+1)*dt;

    const u2=u*u;
    const u3=u2*u;

    return (
      (2*u3-3*u2+1)*v(i)+
      (u3-2*u2+u)*m0+
      (-2*u3+3*u2)*v(i+1)+
      (u3-u2)*m1
    );
  }

  function sampleKeys(t){

    t=
      Math.min(
        Math.max(t,0),
        KEYS[KEYS.length-1].t-
        1e-3
      );

    let i=0;

    while(
      i<KEYS.length-2 &&
      t>=KEYS[i+1].t
    )
      i++;

    return {
      p:[
        crv('p',i,0,t),
        crv('p',i,1,t),
        crv('p',i,2,t)
      ],

      l:[
        crv('l',i,0,t),
        crv('l',i,1,t),
        crv('l',i,2,t)
      ],

      f:
        crv(
          'f',
          i,
          undefined,
          t
        ),

      ky:
        Math.min(
          1,
          Math.max(
            0,
            crv(
              'ky',
              i,
              undefined,
              t
            )
          )
        )
    };
  }

  const MODES={

    hero:{
      p:[-58,16,190],
      l:[-22,6,-45],
      f:40
    },

    dash:{
      p:[-120,36,340],
      l:[-60,12,-80],
      f:36
    },

    quiz:{
      p:[105,14,250],
      l:[38,5,-70],
      f:38
    }
  };

  const mw={
    hero:1,
    dash:0,
    quiz:0
  };

  let modeTarget='hero';

  API.setMode=
    m=>{
      modeTarget=
        MODES[m]
        ? m
        : 'hero';
    };

  /* ───────────── Main loop ───────────── */

  let T=0;
  let running=false;
  let started=false;
  let lastNow=0;
  let introCb=null;
  let frames=0;
  let fpsAcc=0;
  const dbsV=new THREE.Vector2();
  let slowWin=0, fastWin=0, coolOff=0, warm=2, shadowsOff=false, emergency=0;
  let qualityChecks=0;
  let telemT=0;

  const camPos=
    new THREE.Vector3();

  const look=
    new THREE.Vector3();

  const Cc=
    new THREE.Vector3();

  const tmp=
    new THREE.Vector3();

  let idleClock=0;
  let shake=0;

  API.onIntroEnd=
    f=>{
      introCb=f;
    };

  API.start=()=>{
    T=0;
    running=true;
    started=true;
    API.introDone=false;
  };

  API.skip=()=>{
    T=
      Math.max(
        T,
        reduced
          ? SKIP_T
          : SKIP_T
      );

    if(!API.introDone)
      finishIntro();
  };

  function finishIntro(){

    API.introDone=true;

    if(introCb)
      introCb();
  }

  if(reduced){

    T=SKIP_T;
    running=true;
    started=true;
    API.introDone=true;
  }

  function resize(){

    const w=
      window.innerWidth;

    const h=
      window.innerHeight;

    renderer.setSize(
      w,
      h,
      false
    );

    camera.aspect=
      w/h;

    camera.updateProjectionMatrix();
  }

  let resizeQueued=false;
  const queueResize=()=>{
    if(resizeQueued) return;
    resizeQueued=true;
    requestAnimationFrame(()=>{ resizeQueued=false; resize(); });
  };
  window.addEventListener('resize', queueResize);
  window.addEventListener('orientationchange', queueResize);

  resize();

  function frame(now){

    requestAnimationFrame(
      frame
    );

    if(document.hidden){

      lastNow=now;
      return;
    }

    const dt=
      Math.min(
        .05,
        (now-lastNow)/1000 ||
        .016
      );

    lastNow=now;

    if(running)
      T+=dt;

    if(T>400)
      T-=340;

    idleClock+=dt;

    if(
      T>=INTRO &&
      !API.introDone &&
      !reduced
    )
      finishIntro();

    API.T=T;

    const s=
      sampleTraj(T);

    const aspect=
      camera.aspect;

    const portrait=
      aspect<.95;

    /* aircraft state */

    const tf=T;

    const onGround=
      s.alt<.2 &&
      tf<T_LIFT;

    const gust=
      Math.sin(tf*1.7)*.12+
      Math.sin(tf*.63)*.18;

    const flex=
      -.5+
      2.2*
      sm(
        T_LIFT,
        20.5,
        tf
      )+
      (tf>T_LIFT
        ? gust
        : 0);

    plane.wings.forEach(
      w=>w.update(flex)
    );

    updateFlaps(
      flex,
      (
        1-
        sm(
          21,
          26,
          tf
        )
      )*
      (
        tf>4
        ? .3
        : 0
      )
    );

    const retract=
      sm(
        19.6,
        22.2,
        tf
      );

    plane.nose.rotation.x=
      retract*Math.PI/2;

    plane.main[0].rotation.z=
      retract*Math.PI/2;

    plane.main[1].rotation.z=
      -retract*Math.PI/2;

    const spinRate=
      onGround
      ? s.v/.5
      : Math.max(
          0,
          20*
          (
            1-
            sm(
              T_LIFT,
              T_LIFT+3,
              tf
            )
          )
        );

    plane.wheels.forEach(
      w=>{
        w.rotation.x-=
          spinRate*dt;
      }
    );

    const throttle=
      tf<3
      ? .12
      : tf<T_ROLL
        ? .12+
          .6*
          sm(
            3,
            T_ROLL,
            tf
          )
        : tf<34
          ? 1
          : 1-
            .3*
            sm(
              34,
              48,
              tf
            );

    plane.fans.forEach(
      (f,i)=>{
        f.rotation.z+=
          dt*
          (10+
          throttle*50)*
          (i?1:-1);
      }
    );

    const roll=
      tf>30
      ? Math.sin(tf*.2)*.05
      : 0;

    pivot.position.set(
      0,
      s.alt,
      s.z
    );

    pivot.rotation.set(
      s.pitch,
      Math.sin(tf*.13)*.01,
      roll
    );

    const f1=
      Math.floor(
        tf*1.3%1*10
      );

    const blink=
      f1===0 ||
      f1===2;

    plane.strobeL.material.opacity=
      plane.strobeR.material.opacity=
      blink
      ? 1
      : 0;

    plane.beacon.material.opacity=
      (
        Math.floor(
          tf*1.2
        )%2
      )
      ? 1
      : .1;

    const tipY=
      plane.wings[0].yc(
        1,
        flex
      )+
      1.6;

    plane.navL.position.y=
      plane.navR.position.y=
      plane.strobeL.position.y=
      plane.strobeR.position.y=
      tipY;

    plane.model.updateMatrixWorld(
      true
    );

    plane.model.getWorldPosition(
      Cc
    );

    const spotI=
      (
        tf>3
        ? 1
        : 0
      )*
      (
        1-
        sm(
          22,
          28,
          tf
        )
      )*
      5;

    plane.spots.forEach(
      sp=>{
        sp.intensity=
          spotI;
      }
    );

    plane.lights.forEach(
      l=>{
        l.material.opacity=
          Math.min(
            1,
            spotI/4
          )*.8;
      }
    );

    /* exhaust */

    {
      const a=
        exhaust.geometry.attributes;

      const rate=
        throttle*60;

      const em=
        Math.floor(
          rate*dt+
          Math.random()
        );

      const vBack=
        Math.max(
          8,
          30-s.v*.2
        );

      for(
        let k=0;
        k<em;
        k++
      )
      for(
        let e=0;
        e<2;
        e++
      ){

        const i=
          ex.head++%
          (EXN*2);

        plane.exhaust[e]
          .localToWorld(
            tmp.set(
              0,
              0,
              4.6
            )
          );

        a.position.setXYZ(
          i,
          tmp.x+
          (Math.random()-.5)*.5,
          tmp.y+
          (Math.random()-.5)*.5,
          tmp.z
        );

        ex.age[i]=0;

        ex.vel[i*3]=
          (Math.random()-.5)*2;

        ex.vel[i*3+1]=
          (Math.random()-.3)*2;

        ex.vel[i*3+2]=
          vBack+
          Math.random()*8-
          s.v*.5;
      }

      for(
        let i=0;
        i<EXN*2;
        i++
      ){

        ex.age[i]+=dt;

        const life=
          ex.age[i]/.9;

        if(life>=1){

          a.aAlpha.setX(
            i,
            0
          );

          continue;
        }

        a.position.setXYZ(
          i,
          a.position.getX(i)+
          ex.vel[i*3]*dt,

          a.position.getY(i)+
          ex.vel[i*3+1]*dt,

          a.position.getZ(i)+
          ex.vel[i*3+2]*dt
        );

        a.aSize.setX(
          i,
          1+
          life*5
        );

        a.aAlpha.setX(
          i,
          (1-life)*
          .22*
          throttle
        );

        a.aColor.setXYZ(
          i,
          1,
          .78-life*.3,
          .55
        );
      }

      a.position.needsUpdate=
        a.aSize.needsUpdate=
        a.aAlpha.needsUpdate=
        a.aColor.needsUpdate=
        true;
    }

    /* world follows aircraft */

    ground.position.set(
      Cc.x,
      0,
      Cc.z
    );

    trees.position.z =
      Math.round(Cc.z/TREE_P)*TREE_P;

    city.position.z =
      Math.round(Cc.z/CITY_P)*CITY_P;

    worldUpdate(T);

    grassTex.offset.set(
      Cc.x/GS*GREP,
      -Cc.z/GS*GREP
    );

    hazeBanks.position.set(
      Cc.x*.9,
      0,
      Cc.z*.92
    );

    shafts.position.set(
      Cc.x,
      0,
      Cc.z
    );

    const shaftA=
      (
        sm(
          21,
          27,
          tf
        )*
        (
          1-
          sm(
            36,
            46,
            tf
          )
        )*
        .16
      )+
      .035*
      sm(
        40,
        50,
        tf
      );

    shaftMats.forEach(
      m=>{
        m.opacity=
          shaftA;
      }
    );

    sun.position.set(
      Cc.x+
      sunDir.x*400,

      Cc.y+
      sunDir.y*400,

      Cc.z+
      sunDir.z*400
    );

    sun.target.position.copy(
      Cc
    );

    sun.target.updateMatrixWorld();

    /* camera */

    const km=
      sampleKeys(T);

    const idleK=
      sm(
        44,
        48,
        T
      );

    for(
      const k in mw
    ){

      mw[k]+=
        (
          (
            k===modeTarget
            ? 1
            : 0
          )-
          mw[k]
        )*
        (
          1-
          Math.exp(
            -dt*1.6
          )
        );
    }

    const idle={
      p:[0,0,0],
      l:[0,0,0],
      f:0
    };

    for(
      const k in MODES
    ){

      const w=mw[k];

      for(
        let c=0;
        c<3;
        c++
      ){

        idle.p[c]+=
          MODES[k].p[c]*w;

        idle.l[c]+=
          MODES[k].l[c]*w;
      }

      idle.f+=
        MODES[k].f*w;
    }

    const dr=
      reduced
      ? .25
      : 1;

    const dsc=
      sm(
        46,
        54,
        T
      );

    idle.p[0]+=
      Math.sin(
        idleClock*.11
      )*
      14*
      dr*
      dsc;

    idle.p[1]+=
      Math.sin(
        idleClock*.08
      )*
      3.2*
      dr*
      dsc;

    idle.p[2]+=
      Math.cos(
        idleClock*.07
      )*
      10*
      dr*
      dsc;

    const P=
      [0,1,2].map(
        c=>
          lerp(
            km.p[c],
            idle.p[c],
            idleK
          )
      );

    const L=
      [0,1,2].map(
        c=>
          lerp(
            km.l[c],
            idle.l[c],
            idleK
          )
      );

    let fov=
      lerp(
        km.f,
        idle.f,
        idleK
      );

    const ky=
      lerp(
        km.ky,
        1,
        idleK
      );

    const sc=
      portrait
      ? 1.5
      : 1;

    if(portrait){

      fov=
        Math.min(
          70,
          fov*1.45
        );

      L[0]*=.25;
      L[1]-=10*idleK;
    }

    shake=
      onGround &&
      T>T_ROLL
      ?
        Math.min(
          1,
          s.v/70
        )*
        (
          1-
          sm(
            T_LIFT-1,
            T_LIFT,
            T
          )
        )
      :
        0;

    const sh=
      reduced
      ? 0
      :
        shake*.05+
        sm(
          T_LIFT,
          T_LIFT+2,
          T
        )*
        (
          1-
          sm(
            T_LIFT+2,
            T_LIFT+7,
            T
          )
        )*
        .04;

    const t7=
      T*23;

    camPos.set(
      Cc.x+
      P[0]*sc+
      Math.sin(t7)*sh,

      Math.max(
        1.3,
        P[1]*
        (portrait?1.1:1)+
        Cc.y*ky
      )+
      Math.sin(
        t7*1.3+1
      )*sh,

      Cc.z+
      P[2]*sc
    );

    look.set(
      Cc.x+L[0],
      Cc.y+L[1],
      Cc.z+L[2]
    );

    camera.position.copy(
      camPos
    );

    camera.lookAt(
      look
    );

    if(
      Math.abs(
        camera.fov-fov
      )>.01
    ){

      camera.fov=fov;

      camera.updateProjectionMatrix();
    }

    sky.position.copy(
      camPos
    );

    /* atmosphere */

    const altN=
      sm(
        0,
        700,
        Cc.y
      );

    skyUniforms.uAlt.value=
      altN;

    scene.fog.density=
      lerp(
        .00026,
        .00011,
        altN
      );

    glowUniforms.uFog.value=
      scene.fog.density;

    renderer.toneMappingExposure=
      lerp(
        .92,
        1.0,
        altN
      );

    /* clouds */

    const cz=Cc.z;

    for(
      let i=0;
      i<clouds.length;
      i++
    ){

      const c=clouds[i];
      const sp=c.sprite;

      if(
        sp.position.z>
        cz+CWIN_BEHIND
      )
        placeCloud(
          c,
          cz-
          CWIN_AHEAD+
          crng()*300
        );

      const d=
        sp.position.distanceTo(
          camPos
        );

      sp.material.opacity=
        c.base*
        sm(
          c.w*.12,
          c.w*.65,
          d
        );
    }

    const dbs=
      renderer.getDrawingBufferSize(dbsV);

    glowUniforms.uScale.value=
      dbs.y/
      (
        2*
        Math.tan(
          THREE.MathUtils.degToRad(
            camera.fov
          )/2
        )
      );

    renderer.render(
      scene,
      camera
    );

    /* telemetry */

    API.state={
      T,
      altFt:
        Cc.y>5
        ? (Cc.y-GROUND_Y)*3.281
        : 0,

      kts:s.v*1.944,

      throttle,

      speedN:
        Math.min(
          1,
          s.v/140
        ),

      altN,

      onGround
    };

    telemT+=dt;

    if(
      opts.onTelemetry &&
      telemT>.1
    ){

      telemT=0;

      opts.onTelemetry(
        API.state
      );
    }

    fpsAcc+=dt;
    frames++;

    if(fpsAcc>=1.0){

      const fps=frames/fpsAcc;

      frames=0;
      fpsAcc=0;

      if(warm>0){
        warm--;                       // ignore start-up hitches
      }else if(fps<42){
        fastWin=0;
        if(++slowWin>=2){
          slowWin=0;
          if(pr>PR_MIN+.01){
            pr=Math.max(PR_MIN,pr*.85);
            renderer.setPixelRatio(pr);
            resize();
            coolOff=6;
          }else if(!shadowsOff && renderer.shadowMap.enabled && fps<24 && slowWin===0 && ++emergency>=3){
            shadowsOff=true;          // last resort: drop shadows once
            renderer.shadowMap.enabled=false;
            sun.castShadow=false;
            scene.traverse(o=>{
              if(o.material){
                (Array.isArray(o.material)?o.material:[o.material])
                  .forEach(m=>{ m.needsUpdate=true; });
              }
            });
          }
        }
      }else if(fps>=57){
        slowWin=0;
        if(coolOff>0) coolOff--;
        else if(++fastWin>=3 && pr<PR_MAX-.01){
          fastWin=0;
          pr=Math.min(PR_MAX,pr*1.1);
          renderer.setPixelRatio(pr);
          resize();
        }
      }else{
        slowWin=0;
      }
    }
  }

  try{ renderer.compile(scene,camera); }catch(e){}

  requestAnimationFrame(
    t=>{
      lastNow=t;
      frame(t);
    }
  );

  API.ok=true;

  return true;
};

})();
