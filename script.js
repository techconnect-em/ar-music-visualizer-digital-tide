document.addEventListener('DOMContentLoaded', () => {
    let audioContext, analyser, source;
    const audioControl = document.getElementById('audio-control');
    const audio = document.getElementById('audio');
    const scanningOverlay = document.getElementById('scanning-overlay');
    const scene = document.querySelector('a-scene');
    const sphere = document.getElementById('visualSphere');
    const model = document.getElementById('base-entity');
    const equalizerContainer = document.getElementById('equalizer-container');
    const mindarTarget = document.querySelector('[mindar-image-target]');
    const lyricsOverlay = document.getElementById('lyrics-overlay');
    const toggleLyricsButton = document.getElementById('toggle-lyrics');
    const websiteButton = document.getElementById('website-button');

    //音楽再生バー
    const seekBar = document.getElementById('seek-bar');
    const currentTimeDisplay = document.getElementById('current-time');
    const durationDisplay = document.getElementById('duration');

    const FFT_SIZE = 256;
    const numBars = 32; // 固定のバーの数に変更
    let bars = [];
    let isLyricsVisible = false;

    // 3Dパーティクルシステムの定数（視認性向上のため最適化）
    const PARTICLE_COUNT = 7500; // 15000から7500に削減（半分）
    const SHAPE_STABLE_TIME = 4000; // 4秒
    const MORPHING_TIME = 2000; // 2秒
    const ANIMATION_CYCLE = SHAPE_STABLE_TIME + MORPHING_TIME; // 6秒

    // パーティクルシステムの変数
    let particleSystem = null;
    let particleGeometry = null;
    let particleMaterial = null;
    let particlePositions = null;
    let particleColors = null;
    
    // 形状データ（事前計算済み）
    let torusPositions = null;
    let spherePositions = null;
    let lissajousPositions = null;
    
    // アニメーション状態
    let currentShape = 'TORUS';
    let nextShape = 'SPHERE';
    let morphProgress = 0;
    let animationStartTime = 0;
    let isStable = true;
    
    // パフォーマンス最適化用変数
    let lastUpdateTime = 0;
    const UPDATE_FREQUENCY = 16; // 60FPS相当
    let frameSkipCounter = 0;
    const MAX_FRAME_SKIP = 2; // 最大2フレームまでスキップ可能
    
    // パフォーマンス監視用変数
    let frameCount = 0;
    let lastFpsTime = 0;
    let currentFps = 60;
    let performanceLevel = 'high'; // 'high', 'medium', 'low'

    // 歌詞の初期状態設定
    isLyricsVisible = false;
    lyricsOverlay.style.display = 'none';

    // 3つの形状の数学的定義と事前計算
    function generateTorusPositions() {
        const positions = new Float32Array(PARTICLE_COUNT * 3);
        const R = 2; // 主半径
        const r = 0.8; // 管半径
        
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const u = Math.random() * Math.PI * 2; // [0, 2π]
            const v = Math.random() * Math.PI * 2; // [0, 2π]
            
            const x = (R + r * Math.cos(v)) * Math.cos(u);
            const y = (R + r * Math.cos(v)) * Math.sin(u);
            const z = r * Math.sin(v);
            
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
        }
        
        return positions;
    }

    function generateSpherePositions() {
        const positions = new Float32Array(PARTICLE_COUNT * 3);
        const R = 2.2; // 半径
        
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const lat = Math.random() * Math.PI; // [0, π]
            const lon = Math.random() * Math.PI * 2; // [0, 2π]
            
            const x = R * Math.sin(lat) * Math.cos(lon);
            const y = R * Math.sin(lat) * Math.sin(lon);
            const z = R * Math.cos(lat);
            
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
        }
        
        return positions;
    }

    function generateLissajousPositions() {
        const positions = new Float32Array(PARTICLE_COUNT * 3);
        const a = 3, b = 5, c = 7; // 周波数
        const A = 2, B = 2, C = 2; // 振幅
        const delta1 = Math.PI / 2, delta2 = Math.PI / 4; // 位相
        const thicknessRadius = 0.08; // 線の太さ
        
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const t = (i / PARTICLE_COUNT) * Math.PI * 4; // より均等な分布
            
            // 基本のリサージュカーブ
            const baseX = A * Math.sin(a * t + delta1);
            const baseY = B * Math.sin(b * t);
            const baseZ = C * Math.sin(c * t + delta2);
            
            // 線の太さを作るためのランダムオフセット
            const offsetAngle = Math.random() * Math.PI * 2;
            const offsetRadius = Math.random() * thicknessRadius;
            
            // 法線方向にオフセットを追加（簡易的な方法）
            const offsetX = Math.cos(offsetAngle) * offsetRadius;
            const offsetY = Math.sin(offsetAngle) * offsetRadius;
            
            positions[i * 3] = baseX + offsetX;
            positions[i * 3 + 1] = baseY + offsetY;
            positions[i * 3 + 2] = baseZ;
        }
        
        return positions;
    }

    // EaseInOutSine イージング関数
    function easeInOutSine(x) {
        return -(Math.cos(Math.PI * x) - 1) / 2;
    }

    // シンプルなパーリンノイズ実装
    function generateNoiseTable() {
        const table = [];
        for (let i = 0; i < 256; i++) {
            table[i] = Math.random() * 2 - 1;
        }
        return table;
    }

    const noiseTable = generateNoiseTable();

    function noise(x, y, z) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        
        const fx = x - Math.floor(x);
        const fy = y - Math.floor(y);
        const fz = z - Math.floor(z);
        
        const u = fade(fx);
        const v = fade(fy);
        const w = fade(fz);
        
        const A = (noiseTable[X] + Y) & 255;
        const B = (noiseTable[X + 1] + Y) & 255;
        const AA = (noiseTable[A] + Z) & 255;
        const AB = (noiseTable[A + 1] + Z) & 255;
        const BA = (noiseTable[B] + Z) & 255;
        const BB = (noiseTable[B + 1] + Z) & 255;
        
        return lerp(w, lerp(v, lerp(u, grad(noiseTable[AA], fx, fy, fz),
                                      grad(noiseTable[BA], fx - 1, fy, fz)),
                              lerp(u, grad(noiseTable[AB], fx, fy - 1, fz),
                                      grad(noiseTable[BB], fx - 1, fy - 1, fz))),
                      lerp(v, lerp(u, grad(noiseTable[AA + 1], fx, fy, fz - 1),
                                      grad(noiseTable[BA + 1], fx - 1, fy, fz - 1)),
                              lerp(u, grad(noiseTable[AB + 1], fx, fy - 1, fz - 1),
                                      grad(noiseTable[BB + 1], fx - 1, fy - 1, fz - 1))));
    }

    function fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    function lerp(t, a, b) {
        return a + t * (b - a);
    }

    function grad(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    // 色の補間関数
    function lerpColor(color1, color2, t) {
        return {
            r: color1.r + (color2.r - color1.r) * t,
            g: color1.g + (color2.g - color1.g) * t,
            b: color1.b + (color2.b - color1.b) * t
        };
    }

    // 形状の色定義（明るい背景での視認性向上のため調整）
    const shapeColors = {
        TORUS: { r: 1.0, g: 1.0, b: 0.0 },      // 明るい黄色（青背景の補色）
        SPHERE: { r: 1.0, g: 0.5, b: 0.0 },     // 明るいオレンジ
        LISSAJOUS: { r: 1.0, g: 0.0, b: 0.5 }   // 明るいピンク
    };

    // パーティクルシステムの初期化
    function initParticleSystem() {
        console.log('Initializing particle system...');
        
        // 形状データの事前計算
        torusPositions = generateTorusPositions();
        spherePositions = generateSpherePositions();
        lissajousPositions = generateLissajousPositions();
        
        // BufferGeometry の作成
        particleGeometry = new THREE.BufferGeometry();
        
        // 位置属性の初期化（トーラスから開始）
        particlePositions = new Float32Array(torusPositions);
        particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
        
        // 色属性の初期化
        particleColors = new Float32Array(PARTICLE_COUNT * 3);
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particleColors[i * 3] = shapeColors.TORUS.r;
            particleColors[i * 3 + 1] = shapeColors.TORUS.g;
            particleColors[i * 3 + 2] = shapeColors.TORUS.b;
        }
        particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));
        
        // マテリアルの作成（明るい背景での視認性向上）
        particleMaterial = new THREE.PointsMaterial({
            size: 0.10, // 0.08から0.10に拡大（さらに大きく）
            sizeAttenuation: true,
            vertexColors: true,
            blending: THREE.NormalBlending, // AdditiveBlendingから変更
            transparent: true,
            opacity: 0.95 // NormalBlendingに合わせて調整
        });
        
        // パーティクルシステムの作成
        particleSystem = new THREE.Points(particleGeometry, particleMaterial);
        
        console.log('Particle system initialized successfully.');
        return particleSystem;
    }

    // アニメーション状態管理
    function getNextShape(current) {
        const shapes = ['TORUS', 'SPHERE', 'LISSAJOUS'];
        const currentIndex = shapes.indexOf(current);
        return shapes[(currentIndex + 1) % shapes.length];
    }

    function getShapePositions(shapeName) {
        switch (shapeName) {
            case 'TORUS': return torusPositions;
            case 'SPHERE': return spherePositions;
            case 'LISSAJOUS': return lissajousPositions;
            default: return torusPositions;
        }
    }

    // パフォーマンス監視とレベル調整
    function updatePerformanceLevel() {
        frameCount++;
        const currentTime = Date.now();
        
        if (currentTime - lastFpsTime > 1000) { // 1秒間隔でFPS計測
            currentFps = frameCount;
            frameCount = 0;
            lastFpsTime = currentTime;
            
            // パフォーマンスレベル自動調整
            if (currentFps < 30) {
                performanceLevel = 'low';
            } else if (currentFps < 45) {
                performanceLevel = 'medium';
            } else {
                performanceLevel = 'high';
            }
            
            console.log(`FPS: ${currentFps}, Performance Level: ${performanceLevel}`);
        }
    }
    
    // パフォーマンスレベルに応じた設定取得（15000パーティクル用に最適化）
    function getPerformanceSettings() {
        switch (performanceLevel) {
            case 'low':
                return {
                    updateFrequency: 33, // 30FPS
                    batchSize: 1000, // 15000パーティクル用に調整
                    colorBatchSize: 5000,
                    noiseScale: 0.03
                };
            case 'medium':
                return {
                    updateFrequency: 22, // 45FPS
                    batchSize: 750,
                    colorBatchSize: 3750,
                    noiseScale: 0.04
                };
            case 'high':
            default:
                return {
                    updateFrequency: 16, // 60FPS
                    batchSize: 500, // より小さなバッチで滑らかに
                    colorBatchSize: 2500,
                    noiseScale: 0.05
                };
        }
    }

    // パーティクルアニメーション更新（パフォーマンス最適化版）
    function updateParticleAnimation() {
        if (!particleSystem || !particleGeometry) return;
        
        const currentTime = Date.now();
        const settings = getPerformanceSettings();
        
        // パフォーマンス監視
        updatePerformanceLevel();
        
        // フレームレート制御
        if (currentTime - lastUpdateTime < settings.updateFrequency) {
            frameSkipCounter++;
            if (frameSkipCounter < MAX_FRAME_SKIP) {
                return; // フレームスキップ
            }
        }
        
        lastUpdateTime = currentTime;
        frameSkipCounter = 0;
        
        const cycleTime = (currentTime - animationStartTime) % ANIMATION_CYCLE;
        
        if (cycleTime < SHAPE_STABLE_TIME) {
            // 安定表示期間
            isStable = true;
            morphProgress = 0;
        } else {
            // モーフィング期間
            if (isStable) {
                // モーフィング開始
                isStable = false;
                currentShape = nextShape;
                nextShape = getNextShape(currentShape);
                console.log(`Starting morphing from ${currentShape} to ${nextShape}`);
            }
            
            // モーフィング進捗計算
            const morphTime = cycleTime - SHAPE_STABLE_TIME;
            morphProgress = Math.min(morphTime / MORPHING_TIME, 1);
            
            // EaseInOutSine イージング適用
            const easedProgress = easeInOutSine(morphProgress);
            
            // 位置の補間（バッチ処理最適化）
            const currentPositions = getShapePositions(currentShape);
            const targetPositions = getShapePositions(nextShape);
            const time = currentTime * 0.001; // 時間スケール
            const noiseScale = settings.noiseScale; // パフォーマンスレベルに応じたノイズ適用量
            
            // バッチ処理でパフォーマンス向上（動的サイズ調整）
            const batchSize = settings.batchSize;
            for (let batch = 0; batch < PARTICLE_COUNT; batch += batchSize) {
                const endIndex = Math.min(batch + batchSize, PARTICLE_COUNT);
                
                for (let i = batch; i < endIndex; i++) {
                    const i3 = i * 3;
                    
                    // 位置の線形補間
                    const lerpedX = currentPositions[i3] + (targetPositions[i3] - currentPositions[i3]) * easedProgress;
                    const lerpedY = currentPositions[i3 + 1] + (targetPositions[i3 + 1] - currentPositions[i3 + 1]) * easedProgress;
                    const lerpedZ = currentPositions[i3 + 2] + (targetPositions[i3 + 2] - currentPositions[i3 + 2]) * easedProgress;
                    
                    // パーリンノイズによる微細な動き（計算量を削減）
                    const noiseX = noise(lerpedX * 0.1, lerpedY * 0.1, time) * noiseScale;
                    const noiseY = noise(lerpedX * 0.1 + 100, lerpedY * 0.1 + 100, time) * noiseScale;
                    const noiseZ = noise(lerpedX * 0.1 + 200, lerpedY * 0.1 + 200, time) * noiseScale;
                    
                    particlePositions[i3] = lerpedX + noiseX;
                    particlePositions[i3 + 1] = lerpedY + noiseY;
                    particlePositions[i3 + 2] = lerpedZ + noiseZ;
                }
                
                // バッチ処理完了時に短時間のブレークでメインスレッドを解放
                if (batch + batchSize < PARTICLE_COUNT) {
                    // requestAnimationFrameで非同期化（フレームドロップ防止）
                    setTimeout(() => {}, 0);
                }
            }
            
            // 色の補間（最適化版）
            const currentColor = shapeColors[currentShape];
            const targetColor = shapeColors[nextShape];
            const lerpedColor = lerpColor(currentColor, targetColor, easedProgress);
            
            // 色の更新は位置よりも軽い処理なので、より大きなバッチで処理（動的サイズ調整）
            const colorBatchSize = settings.colorBatchSize;
            for (let batch = 0; batch < PARTICLE_COUNT; batch += colorBatchSize) {
                const endIndex = Math.min(batch + colorBatchSize, PARTICLE_COUNT);
                
                for (let i = batch; i < endIndex; i++) {
                    const i3 = i * 3;
                    particleColors[i3] = lerpedColor.r;
                    particleColors[i3 + 1] = lerpedColor.g;
                    particleColors[i3 + 2] = lerpedColor.b;
                }
            }
            
            // 属性の更新フラグ設定
            particleGeometry.attributes.position.needsUpdate = true;
            particleGeometry.attributes.color.needsUpdate = true;
        }
    }

    // A-Frame パーティクルアニメーションコンポーネント
    AFRAME.registerComponent('particle-animation', {
        init: function() {
            this.particleSystem = initParticleSystem();
            this.el.object3D.add(this.particleSystem);
            animationStartTime = Date.now();
            console.log('Particle animation component initialized.');
        },
        
        tick: function() {
            updateParticleAnimation();
        }
    });

    // リンクボタンのイベントリスナー
    websiteButton.addEventListener('click', () => {
        window.open('https://www.instagram.com/techconnect.em/', '_blank');
    });


     // 再生時間を整形する関数
    function formatTime(seconds) {
       const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);

         // 負の時間を考慮
         const absMins = Math.abs(mins);
        const absSecs = Math.abs(secs);

         const formattedMins = String(absMins).padStart(0, '0');
        const formattedSecs = String(absSecs).padStart(2, '0');
        return `${mins < 0 ? '-' : ''}${formattedMins}:${formattedSecs}`;
    }

   // イベントリスナー: メタデータがロードされたとき
    audio.addEventListener('loadedmetadata', () => {
        if (isNaN(audio.duration)) {
            console.warn("audio.duration is NaN. Trying again...");
            return;
        }
        const durationInSeconds = audio.duration;
        seekBar.max = durationInSeconds;
        durationDisplay.textContent = formatTime(durationInSeconds); // durationを初期化
    });

    // イベントリスナー: 再生時間が更新されたとき
    audio.addEventListener('timeupdate', () => {
        currentTimeDisplay.textContent = formatTime(audio.currentTime);
        seekBar.value = audio.currentTime;
          // 経過時間から残りの時間を計算して表示
        const timeLeft = audio.duration - audio.currentTime;
        durationDisplay.textContent = formatTime(timeLeft);
    });

    // イベントリスナー: seek barが変更されたとき
    seekBar.addEventListener('input', () => {
        audio.currentTime = seekBar.value;
        currentTimeDisplay.textContent = formatTime(audio.currentTime);
    });

    // イベントリスナー: 楽曲の再生が終わったとき
    audio.addEventListener('ended', () => {
        audioControl.querySelector('i').className = 'fas fa-play';
    });


    // 音声解析の初期化
    async function initAudioAnalyser() {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            await audioContext.resume();

            analyser = audioContext.createAnalyser();
            analyser.fftSize = FFT_SIZE;
            analyser.smoothingTimeConstant = 0.85;
            source = audioContext.createMediaElementSource(audio);
            source.connect(analyser);
            analyser.connect(audioContext.destination);

            // イコライザーバーの初期化
            try {
                for (let i = 0; i < numBars; i++) {
                    const bar = document.createElement('a-entity');
                    bar.setAttribute('geometry', `primitive: box; width: 0.02; height: 0.1; depth: 0.02`);
                    bar.setAttribute('material', `color: yellow`);
                    equalizerContainer.appendChild(bar);
                    bars.push(bar);
                }
                console.log('Equalizer bars initialized successfully.');
            } catch (error) {
                console.error('Error initializing equalizer bars:', error);
            }


            return true;
        } catch (error) {
            console.error('Audio analyser initialization error:', error);
            return false;
        }
    }

    // 音声データの解析と視覚化
    AFRAME.registerComponent('audio-visualizer', {
        init: function () {
            this.barWidth = 0.02;
            this.barColor = 'yellow';
            this.equalizerRadius = 1.1;
            this.smoothing = 0.3;
            this.barHeights = new Array(numBars).fill(0); // スムージング用の配列
            console.log('Audio visualizer component initialized.');
        },
        tick: function () {
            if (analyser && !audio.paused) {
                const freqByteData = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(freqByteData);

                // スフィアのスケールを変更
                let avgScale = 0;
                for (let i = 0; i < freqByteData.length; i++) {
                    avgScale += freqByteData[i];
                }
                avgScale /= freqByteData.length;
                const scale = 1 + (avgScale / 255) * 0.5;
                this.el.object3D.scale.set(scale, scale, scale);

                // イコライザーバーの更新
                this.updateEqualizerBars(freqByteData);
            }
        },
        updateEqualizerBars: function (freqByteData) {
            try {
                const targetPosition = mindarTarget.object3D.position;
                const radius = parseFloat(sphere.getAttribute('radius')) * this.equalizerRadius;
                const sphereBottomY = targetPosition.y - parseFloat(sphere.getAttribute('radius'));

                for (let i = 0; i < numBars; i++) {
                    const bar = bars[i];

                    if (!bar) {
                        console.error('bar is null or undefined:', i, bars);
                        continue;
                    }
                    // 使用する周波数データを選択（高周波数帯域をカット）
                    const freqIndex = Math.floor((i / numBars) * (FFT_SIZE / 2));
                    const freqSum = freqByteData[freqIndex] || 0;
                    let barHeight = (freqSum / 255) * 1.5;
                    barHeight = Math.max(0.1, barHeight); // 最小値を設定

                    // スムージング処理
                    this.barHeights[i] = this.barHeights[i] + (barHeight - this.barHeights[i]) * this.smoothing;

                    let angle = 0;
                    if (numBars > 1) {
                        angle = (i / (numBars - 1)) * Math.PI - (Math.PI / 2);
                    }
                    const x = Math.cos(angle - Math.PI / 2) * radius;
                    const z = Math.sin(angle - Math.PI / 2) * radius;
                    const y = sphereBottomY + this.barHeights[i] / 2;

                    bar.setAttribute('position', `${targetPosition.x + x} ${y} ${targetPosition.z + z}`);
                    bar.setAttribute('geometry', `primitive: box; width: ${this.barWidth}; height: ${this.barHeights[i]}; depth: ${this.barWidth}`);
                    bar.setAttribute('rotation', `0 ${-angle * 180 / Math.PI - 90} 0`);
                }
            } catch (error) {
                console.error('Error during equalizer animation:', error);
            }
        }
    });

    sphere.setAttribute('audio-visualizer', '');

    let isTargetFound = false;
    
    scene.addEventListener('targetFound', () => {
        isTargetFound = true;
        scanningOverlay.classList.add('fade-out');
        // 歌詞表示は手動制御のまま維持
    });

    scene.addEventListener('targetLost', () => {
        isTargetFound = false;
        scanningOverlay.classList.remove('fade-out');
        // 歌詞表示は手動制御のまま維持
    });

    scene.addEventListener('error', (e) => {
        console.error('A-Frame scene error:', e);
    });

    // iOS対応: MindARのビデオ要素にplaysinline属性を追加
    function ensurePlaysinlineForMindAR() {
        console.log('🍎 Ensuring playsinline for iOS compatibility...');
        
        // MindARが生成するビデオ要素を監視
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // ビデオ要素を探す
                        const videos = node.tagName === 'VIDEO' ? [node] : node.querySelectorAll ? node.querySelectorAll('video') : [];
                        videos.forEach((video) => {
                            if (!video.hasAttribute('playsinline')) {
                                video.setAttribute('playsinline', '');
                                video.setAttribute('webkit-playsinline', '');
                                console.log('✅ Added playsinline to video element:', video);
                            }
                        });
                    }
                });
            });
        });
        
        // documentの変更を監視
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // 5秒後に監視を停止
        setTimeout(() => {
            observer.disconnect();
            console.log('🛑 Stopped video element monitoring');
        }, 5000);
    }

    // iOS検出とplaysinline対応
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
        console.log('📱 iOS device detected, applying compatibility fixes...');
        ensurePlaysinlineForMindAR();
        
        // iOS用のタップ・トゥ・スタート機能
        setupIOSTapToStart();
    }

    // iOS用のタップ・トゥ・スタート機能
    function setupIOSTapToStart() {
        let hasUserInteracted = false;
        
        function handleFirstInteraction() {
            if (hasUserInteracted) return;
            hasUserInteracted = true;
            
            console.log('👆 User interaction detected, initializing AR for iOS...');
            
            // MindARシーンを強制的に再初期化
            setTimeout(() => {
                try {
                    // 既存のビデオ要素にplaysinline属性を再適用
                    const videos = document.querySelectorAll('video');
                    videos.forEach(video => {
                        video.setAttribute('playsinline', '');
                        video.setAttribute('webkit-playsinline', '');
                        
                        // ビデオが一時停止されている場合は再生を試行
                        if (video.paused && video.readyState >= 2) {
                            video.play().catch(err => {
                                console.log('Video play attempt failed:', err);
                            });
                        }
                    });
                    
                    console.log('🔄 iOS AR re-initialization complete');
                } catch (error) {
                    console.error('❌ iOS AR initialization error:', error);
                }
            }, 500);
            
            // イベントリスナーを削除
            document.removeEventListener('touchstart', handleFirstInteraction);
            document.removeEventListener('click', handleFirstInteraction);
        }
        
        // タッチとクリックの両方を監視
        document.addEventListener('touchstart', handleFirstInteraction, { passive: true });
        document.addEventListener('click', handleFirstInteraction);
        
        console.log('📱 iOS tap-to-start system activated');
    }

    // iOSでのカメラストリーム診断機能
    function diagnoseIOSCameraStream() {
        if (!isIOS) return;
        
        console.log('🔍 Starting iOS camera stream diagnosis...');
        
        // 定期的にビデオ要素の状態をチェック
        const diagnosticInterval = setInterval(() => {
            const videos = document.querySelectorAll('video');
            
            videos.forEach((video, index) => {
                console.log(`📹 Video ${index} status:`, {
                    src: video.src || 'No src',
                    srcObject: video.srcObject ? 'Stream object present' : 'No stream',
                    readyState: video.readyState,
                    paused: video.paused,
                    playsinline: video.hasAttribute('playsinline'),
                    webkitPlaysinline: video.hasAttribute('webkit-playsinline'),
                    width: video.videoWidth,
                    height: video.videoHeight,
                    style: {
                        display: video.style.display,
                        visibility: video.style.visibility,
                        opacity: video.style.opacity
                    }
                });
            });
            
            // A-Frame canvasの状態もチェック
            const canvas = document.querySelector('canvas');
            if (canvas) {
                console.log('🎨 Canvas status:', {
                    width: canvas.width,
                    height: canvas.height,
                    style: {
                        display: canvas.style.display,
                        visibility: canvas.style.visibility
                    }
                });
            }
        }, 3000); // 3秒ごと
        
        // 30秒後に診断を停止
        setTimeout(() => {
            clearInterval(diagnosticInterval);
            console.log('🛑 iOS camera stream diagnosis complete');
        }, 30000);
    }

    // iOS診断を5秒後に開始
    if (isIOS) {
        setTimeout(diagnoseIOSCameraStream, 5000);
    }

    audio.addEventListener('play', updateAudioButton);
    audio.addEventListener('pause', updateAudioButton);


    //音楽再生、歌詞表示、Webサイト移動などのイベントリスナーを定義
    websiteButton.addEventListener('click', () => {
        window.open('https://www.instagram.com/techconnect.em/', '_blank');
    });

    toggleLyricsButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        
        console.log('歌詞ボタンがクリックされました');
        console.log('現在のisLyricsVisible:', isLyricsVisible);
        
        isLyricsVisible = !isLyricsVisible;
        
        // 強制的にスタイルを設定
        if (isLyricsVisible) {
            lyricsOverlay.style.setProperty('display', 'flex', 'important');
            console.log('歌詞を表示に設定');
        } else {
            lyricsOverlay.style.setProperty('display', 'none', 'important');
            console.log('歌詞を非表示に設定');
        }
        
        // 確認のため最終状態をログ出力
        setTimeout(() => {
            console.log('最終的なdisplayプロパティ:', getComputedStyle(lyricsOverlay).display);
        }, 100);
        
        updateLyricsButton();
    });

     function updateLyricsButton() {
        const icon = toggleLyricsButton.querySelector('i');
        icon.className = isLyricsVisible ? 'fas fa-times' : 'fas fa-align-justify';
    }

   audioControl.addEventListener('click', async () => {
        try {
            if (audio.paused) {
                await audio.play();
                await audioContext.resume();
            } else {
                audio.pause();
            }
            updateAudioButton();
        } catch (error) {
            console.error('Audio control error:', error);
        }
    });

    function updateAudioButton() {
        const icon = audioControl.querySelector('i');
        icon.className = audio.paused ? 'fas fa-play' : 'fas fa-pause';
    }

    // DOMContentLoaded以降に実行されるように、initAudioAnalyserの呼び出しをここに移動
    init();
    async function init() {
         await initAudioAnalyser();
    }
});
