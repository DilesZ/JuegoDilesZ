# Worklog — AETHERIA (Action RPG 3D)

---
Task ID: 0
Agent: main (Super Z)
Task: Estado heredado de la sesión anterior

Work Log:
- Proyecto Next.js 16 existente con el juego AETHERIA en src/game/ (core, game, world, models, particles, entities, enemies, animations, audio, minimap).
- Gráficos actuales: low-poly flat, cielo plano, sin texturas, sin AO, bloom básico. Capturas en download/shot_*.png.

Stage Summary:
- Punto de partida registrado. Siguiente: renovación gráfica drástica (texturas PBR procedurales, cielo con aurora, GTAO, grading, hierba con viento, niebla, agua, menú cinemático 3D).

---
Task ID: 1
Agent: main (Super Z)
Task: Mejora gráfica drástica de AETHERIA ("mejora drasticamente los graficos, usa todos los recursos que puedas conseguir")

Work Log:
- Creado `src/game/textures.ts` (nuevo): fábrica de texturas PBR procedurales por canvas — splat de terreno 1024px con senderos bézier pintados (hoguera→santuarios→arena), grava, parches de tierra, roca en altura; normales de detalle; corteza, metal forjado (mapa de rugosidad + arañazos), piedra con grietas y musgo, madera, hoja de hierba con alpha, sprite suave, glow, niebla, luna con cráteres, normales de agua, suelo de arena con círculo rúnico, estandarte raído con emblema.
- Reescrito `models.ts`: materiales PBR compartidos (bark/stone/wood/forged) + `addRim` (rim light fresnel por onBeforeCompile), `registerWind` (viento en shader con anclaje top/bottom), llamas shader (2 planos cruzados con ruido animado), hojas de espada romboidales, espada del héroe con runa emisiva, escudo, capa (raída para el jefe), yelmo con penacho, obelisco con fragmentos orbitantes, hoguera/antorchas con llama shader, geometría de hierba curvada texturizada, setas luminosas.
- Reescrito `world.ts`: cielo con 3 cintas de AURORA (shader animado), 1400 estrellas titilantes con color variado, luna texturizada con dobles halos; niebla FogExp2 afinada + 10 planos de niebla rasante; terreno con splat + normal de detalle; 135 pinos + 34 árboles muertos + 95 rocas instanciados con variación de tono por instancia; 9000 hierbas con viento; ~120 setas luminosas; luciérnagas shader (130, con near-fade); Fuente Lunar con agua shader (fresnel + destello lunar + ondas); santuarios con anillo rúnico, aura corrupta, wisps de humo y HAZ de purificación al limpiar (y recoloreado teal); arena con suelo rúnico, murete, 6 estandartes raídos con viento y antorchas de alma rojas; meteoritos fugaces; environment map PMREM del cielo nocturno para reflejos.
- Actualizado `particles.ts`: sprite suave texturizado + rotación por partícula + crecimiento (humo) + clamp de gl_PointSize (corrige bolas gigantes cerca de cámara).
- Actualizado `game.ts`: pipeline RenderPass → GTAOPass (Oclusión Ambiental) → UnrealBloom → OutputPass → ShaderPass de grading (viñeta + grano fílmico + aberración cromática + saturación/contraste), MSAA 4x vía render target con samples, PCFShadowMap, exposición 1.14; MENÚ CINEMÁTICO: el mundo vive detrás del menú con cámara orbitando la hoguera y el héroe en idle; los enemigos aparecen al pulsar Comenzar (beginAdventure); auto-calidad (baja pixelRatio y apaga GTAO si FPS<42); API setQuality; clear de pickups al reaparecer.
- Actualizado `page.tsx` + `core.ts`: arranque en montaje con velo "Forjando el mundo…", menú de cristal con esquinas ornamentales sobre el 3D en vivo, selector de calidad (Bajo/Medio/Alto), botón de pantalla completa, HUD pulido con etiqueta de calidad.
- Depuración con agent-browser: identifiqué y corregí bolas gigantes (luciérnagas/partículas sin clamp de tamaño → clamp + near-fade), pinos lavados (instanceColor oscurecido 0.20/0.33/0.24), aura corrupta excesiva (opacity 0.10-0.14), anillo rúnico rojo tras purificar (ahora teal), sigma PMREM y PCFSoft deprecado, setas demasiado cerca del campamento.
- Verificación: tsc sin errores en src/, ESLint limpio, capturas en download/gfx_*.png (menú cinemático, combate con goblin, haz de purificación, arena del jefe con estandartes), 300-900 FPS en calidad alta.

Stage Summary:
- Salto gráfico completo: de low-poly plano a fantasía nocturna estilizada con PBR procedural, auroras, GTAO, grading cinematográfico, mundo vivo tras el menú y efectos (haces, agua, viento, niebla, llamas shader). Sin dependencias externas nuevas: todo generado por código (canvas/shaders).


---
Task ID: 2
Agent: main (Super Z)
Task: Recursos online gratuitos + arte/diseño + ciclo día/noche ("busca y usa recursos online gratuitos... añade los ciclos dia y noche y que el juego empiece de dia")

Work Log:
- BÚSQUEDA DE RECURSOS (web-search + curl): verificados ambientCG (CC0 PBR), Kenney vía OpenGameArt (CC0), Little Robot Sound Factory (CC-BY 3.0), Cleyton Kauffman exploration theme (libre), Google Fonts vía jsDelivr (OFL), swishes CC0. PolyHaven/Kenney directos bloqueados (404/403) → rutas alternativas usadas.
- ASSETS DESCARGADOS e integrados en public/: 10 texturas PBR fotográficas 1K (Grass001 color/normal/rough/AO, Ground037, Rock012, Bark004), 25 audios (pasos Kenney, swishes→ogg vía ffmpeg, goblins/hechizos/jingles/oro/UI de Little Robot, dragón, tema de exploración 5.4 MB), 5 fuentes (Cinzel, Cinzel Decorative, Grenze Gotisch, Alegreya Sans ×2).
- daynight.ts (NUEVO): ciclo día/noche completo con 10 keyframes interpolados (cielo top/mid/bottom, niebla, luz sol/luna compartida con sombras, hemisférica, relleno, estrellas, aurora, luciérnagas, niebla rasante, antorchas, exposición, entorno PMREM, tinte de agua). Sol/luna con trayectoria paramétrica; reloj "HH:MM" + contador de días; ciclo de 480 s; EMPIEZA A LAS 08:09 (t=0.34). ?tod=0..1 en URL para saltar de hora.
- world.ts: shader de cielo con dispersión atmosférica hacia el sol (uSunDir/uSunTint/uSunGlow); sol como sprites aditivos; luna agrupada con opacidad; uGlobalA compartido en estrellas/aurora/luciérnagas; luz direccional sigue cámara con dirección del ciclo; terreno con normal fotográfica + bump procedural + roughnessMap; antorchas/hoguera realzadas de noche (×nightK); agua refleja la luz activa.
- textures.ts: cargador pbrTex() con cache y fallback; terrainSplat() redibujado con foto CC0 de césped en mosaico + integración tonal al llegar la imagen (needsUpdate); barkMaps/stoneMaps ahora usan fotos PBR de ambientCG.
- audio.ts: capa de samples reales (22 precargados) + síntesis de refuerzo; nuevos métodos footstep/coin/goblinVox/castSpell/victory/defeat/uiOpen; música: tema CC0 en bucle + capa generativa de combate + duckTheme().
- game.ts: ciclo creado tras el mundo; aviso animado amanecer/anochecer; pasos del jugador por distancia; monedas al matar; jingles en victoria/derrota; nightFactor al ctx (enemigos +12% de noche); reloj/día/noche/aviso al HUD; requestLock() con catch (corrige NotAllowedError de pointer lock); fuente Cinzel en números de daño.
- enemies.ts: gruñido goblin al aggro; nightBoost de velocidad.
- page.tsx + globals.css: @font-face + tokens @theme (font-display/logo/gothic/body); logo AETHERIA en Cinzel Decorative con degradado dorado (.aetheria-logo); marco ornamental doble (.aetheria-frame); reloj con icono SVG sol/luna; barra de jefe en Grenze Gotisch; aviso día/noche animado; créditos CC0/CC-BY/OFL en menú y pausa; panel con scroll en 720p.
- DEPURACIÓN: canopies ×0.20→×0.30/0.55/0.31 (antes negros de noche, luego sobreexpuestos de día); paleta diurna calibrada en 3 pasadas (sol 2.45/2.3, hemi 1.0/0.9, exp 1.05); luciérnagas clamp 26px; overlay "1 Issue" era rechazo de pointer lock por click sintético de prueba → catch añadido, click real verificado sin issues.
- VERIFICACIÓN: tsc limpio, ESLint limpio, juego a 420-921 FPS en calidad alta; capturas download/final_menu.png (menú dorado), final_morning.png (día), final_noon.png (mediodía), final_sunset.png (hora dorada con cielo púrpura), final_night.png (noche estrellada con reloj 22:19 e icono luna), art_menu_day.png.

Stage Summary:
- AETHERIA ahora usa arte y sonido reales gratuitos (ambientCG/Kenney/LittleRobot/Cleyton — CC0/CC-BY/OFL, acreditados en el menú) y un ciclo día/noche completo que empieza de día (08:09), con sol y luna, cielo dinámico, noche peligrosa (+12% velocidad enemiga) y UI de fantasía con Cinzel/Grenze Gotisch.

---
Task ID: 3
Agent: main (Super Z)
Task: Estilo anime para todos los personajes y el mundo ("dale estilo anime a todos los personajes y al mundo")

Work Log:
- SISTEMA TOON (models.ts/textures.ts): rampas de cel shading (toonRamp3/4 como DataTexture NearestFilter), fábrica toonMat(); TODOS los materiales del juego migrados de MeshStandardMaterial a MeshToonMaterial (stdMat/metalMat/emisMat/bark/stone/wood/forged/hierba/copas/terreno/estandartes). addRim adaptado a toon.
- CONTORNOS DE TINTA (inverted hull): expandGeometry() + addOutlines() en models.ts; se aplica a los 5 personajes, obeliscos, pilares y arcos; contornos INSTANCIADOS para 135 pinos (copa+tronco) y 95 rocas copiando instanceMatrix. Material compartido BackSide #191322. Los planos (capa) se excluyen (userData.noOutline) porque el truco falla sin volumen.
- PERSONAJES ANIME: ojos grandes estilo anime (esclerótica blanca + iris de color + pupila + brillo, MeshBasicMaterial), boca pequeña, pelo puntiagudo (8 conos, hero navy/goblin verde/orco oscuro), orejas largas (goblin/orco), colmillos, héroe bigHead chibi con diadema abierta + penacho (cara visible), capa carmesí 0xc23050, colores saturados en los 5 creadores. Fix: pelo estaba DENTRO de la esfera de la cabeza → reposicionado; flequillo acortado.
- MUNDO ANIME: 11 nubes cumulus Ghibli (esferas fusionadas, toon, fog:false, tinte por hora del día con cloudTint, deriva lenta); terreno MeshToonMaterial con splat repintado (praderas verde vivo, senderos ocre claro, roca lavanda, sin fotos PBR); tintes de copa pastel; setas/neblina/agua más claras; arena y estandartes toon.
- daynight.ts: 10 keyframes reescritos con paleta anime (día azul vivo #2a72d4 con nubes blancas, amanecer rosa-naranja, atardecer púrpura-rosa #c06a92/#ff9a5e, noche azul-violeta #1a2456 con nubes 0x39456e); campo cloudTint en sample/stops; sigue empezando de día (08:09).
- game.ts: ACES → NeutralToneMapping (conserva saturación), exposición 1.0, grading anime (sat 1.18, grano 0.016, CA 0.0006, viñeta 0.30), bloom 0.38/thr 0.9 (evita quemar copas), GTAO scale 0.85, números de daño con fuente redondeada y borde grueso.
- entities.ts: collectMats acepta MeshToonMaterial (flash de golpe funciona con toon). enemies.ts: fadeMats incluiye contornos (mueren fundiéndose sin contornos fantasma).
- UI ANIME: fuentes redondeadas Baloo 2 + Nunito descargadas de fontsource/jsDelivr (woff2, OFL) a public/fonts; @theme swap en globals.css; velo de carga actualizado.
- DEPURACIÓN VISUAL (agent-browser, 10 capturas en download/anime_*.png): pelo oculto en la cabeza → fijado; losa negra del hull invertido en la capa → excluida; bloom quemando copas al mediodía → threshold 0.9; nube pegada a cámara → radio 165-315 y altura 72-102.
- VERIFICACIÓN: tsc limpio en src/, ESLint limpio, consola sin errores, 265-512 FPS en calidad alta; capturas: anime_final/anime_menu (menú), anime_face2/anime_goblin2 (personajes), anime_sky2 (mediodía con nubes), anime_sunset, anime_night, anime_combat2/3 (combate).

Stage Summary:
- AETHERIA es ahora 100% anime: cel shading por bandas + contornos de tinta en personajes/árboles/rocas/ruinas, protagonistas chibi con ojos grandes, pelo puntiagudo, orejas y colmillos, nubes Ghibli tintadas por el ciclo día/noche (que sigue empezando de día a las 08:09), paletas saturadas y tipografía redondeada. Sin dependencias nuevas.

---
Task ID: 4
Agent: main (Super Z)
Task: Zoom de cámara con rueda del ratón + menú de inventario y equipo ("haz que con la rueda del raton pueda alejar o acerca la camara, añade menu de inventario, de equipo (armadura arma, accesorios etc)")

Work Log:
- items.ts (NUEVO): catálogo de 23 objetos en 5 categorías (armas ×6, armaduras ×4, yelmos ×4, accesorios ×6, consumibles ×3) con rarezas común/raro/épico/legendario (colores gris/azul/púrpura/dorado), stats de equipo (dmg/hp/def/speed/stam/crit como bonos aditivos), rollDrop() con pesos por nivel del héroe (jefes: garantizado épico/legendario), clase Inventory (mochila de 24 huecos con apilado de consumibles, 5 huecos de equipo arma/armadura/yelmo/acc1/acc2, equipar con intercambio automático a la mochila).
- core.ts: HudState ampliado con InvView (vistas serializables de mochila/equipo/stats para React).
- entities.ts: Player con equip stats + perm (bonos permanentes de consumibles); recomputeMaxHp (vida base por nivel + equipo + permanentes, equipar armadura cura la diferencia); dmgMul/moveSpeedMul/critChance/damageReduction; defensa aplica en takeDamage; regen de aguante y velocidad multiplicadas por equipo. Pickup acepta kind 'item' con orbe del color de la rareza. GameCtx.gainItem añadido.
- game.ts: ZOOM con rueda (listener window wheel passive:false, camDistTarget clampeado 2.6–13.5, damp suave λ=9, guardado en uiOpen); sistema uiOpen (mochila congela el mundo con updateWorld(0.0001, frozen), exitPointerLock sin pausa, teclas I/B/Escape alternan, keys/queued limpiados); drops (goblin 17%/archer 19%/orc 27%/jefe 100%); gainItem con número de daño del color de rareza y fallback a oro si mochila llena; refreshEquipStats tiñe la runa del arma según rareza; críticos ahora usan player.critChance (×1.85); equipo inicial: Espada del Errante + Túnica del Errante + Elixir + Piedra de Afilar; API pública toggleInventory/equipFromBag/unequipSlot/useBagItem; emitHud incluye invView.
- page.tsx: panel MOCHILA completo (cabecera con oro y cierre, retrato + nivel, 5 huecos de equipo con bordes de rareza y destello épico+, rejilla de mochila 24 huecos con apilado ×N, caja de detalles al hover con stats/lore, atributos en vivo: vida/daño/reducción/crítico/velocidad/aguante/bajas y acumulación de elixires); botón 🎒 MOCHILA [I] en el HUD; controles del menú ampliados a 12 (Rueda·Zoom, I·Inventario) en grid de 4 columnas; ayuda inferior actualizada.
- globals.css: .aetheria-scroll (scrollbar fina ámbar) y .aetheria-pop (apertura con muelleo del panel).
- DEPURACIÓN: uiSelect no existía → uiClick; restaurados orbes de alma y pasos de jugador eliminados por error en ediciones; tipo RC null en ItemSlot; props g() Game|null.
- VERIFICACIÓN E2E (agent-browser): zoom fuera (target 13.5, cámara elevada) y dentro (2.6, primer plano) verificados en capturas; mochila abre con I, muestra equipo inicial (Vida 120/120 = 100+20 túnica, Daño ×1.10, Reducción 8%); elixir consumido (+12 perm, maxHp 132); piedra consumida (+4% dmg → ×1.14); Anillo de Jade equipado (Vida 150, Reducción 13%); Filo del Alba equipado (Daño ×1.26, Crítico 6%, espada vieja devuelta a la mochila); Escape/I cierran y el juego continúa; consola sin errores; tsc y ESLint limpios; capturas download/inv_*.png, zoom_far.png, zoom_near.png, gameplay_final.png. Nota: los clics crudos CDP dejaron de entregarse a mitad de sesión (capricho del CLI tras un timeout, no del juego) — verificado con eventos sintéticos y clics DOM que todo responde.

Stage Summary:
- AETHERIA ahora tiene zoom de cámara fluido con la rueda (2.6–13.5 m, suavizado) y un sistema RPG completo de inventario/equipo: 23 objetos con 4 rarezas, 5 huecos de equipo que modifican daño/vida/defensa/velocidad/aguante/crítico, consumibles permanentes, botín de enemigos y jefes, detalles y lore en la UI, y la runa del arma brillando del color de su rareza.

---
Task ID: 5
Agent: main (Super Z)
Task: Mercader NPC + reaparición de enemigos estilo MMORPG ("añade el mercader, añade que los enemigos reaparezcan pasado un tiempo como en los mmorpg")

Work Log:
- items.ts: economía nueva — RARITY_VALUE (30/85/190/420 ◈ por rareza), buyPrice (recargo ligero, consumibles ×0.8, redondeo a 5), sellPrice (40%, mín. 6 ◈) y merchantStock(level): 3 consumibles fijos + 6 piezas de equipo sin repetición con sesgo de rareza según nivel del héroe.
- models.ts: buildMerchantRig() (Ferran: chibi anime con ojos ámbar, capucha granate, peto dorado, capa, contorno de tinta) y buildMerchantStall() (2 postes + trasero, toldo a rayas rojo/crema de 6 listones con canto dorado, mostrador con manto granate y rombos emisivos, género: 3 frascos de elixir, saco de monedas con moneda brillante, caja con espada, farol colgante con PointLight y rótulo con emblema de moneda; addOutlines excluyendo planos).
- merchant.ts (NUEVO): clase Merchant — root fijo en coords de mundo y SOLO el rig rota para mirar al héroe (d<8 m; vuelve a su puesto al alejarse); saludo levantando el brazo 1.2 s cada 26 s al acercarse; rótulo sprite canvas "FERRAN · MERCADER" con píldora dorada; farol con parpadeo (intensidad 7×nightFactor); MERCHANT_SPOT (puesto 6.1,7.3 / mercader 6.92,7.3 / frente 4.75,7.3), merchantDist(), colliderList(), greetingLines().
- core.ts: ShopEntryView/ShopSellView/ShopView en HudState (open, name, stock con precios, bag con precios de venta, gold, restockDay).
- game.ts: mercader creado en el constructor con colisiones en world.colliders y surtido inicial; interacción 'merchant' (radio 2.7 del frente) con prompt "E · Comerciar con Ferran el Mercader"; setPanel('inv'|'shop'|null) refactoriza uiOpen (mochila y tienda congelan el mundo, Esc/I/B cierran el panel activo); openShop/closeShop/buyItem (oro insuficiente y mochila llena con aviso flotante)/sellBagItem; shopView() serializado al HUD; saludo del mercader como número de daño dorado; REABASTECEMIENTO DIARIO al cambiar cycle.day (surtido nuevo + aviso "Ferran ha reabastecido su tienda"); el mercader también anima la escena del menú mirando a la cámara.
- RESPAWN MMORPG: RESPAWN_T (goblin 26 s, arquero 32, orco 48, jefe 140); handleEnemyDied agenda reaparición EN EL PUNTO DE SPAWN (e.home): guardias solo si el santuario no está purificado (vuelven siempre), errantes solo si aliveRoam+pending < ROAMER_TARGET+2; el jefe agota bossRespawnT=140 en modo infinito (respawn de jefe de mundo, cada vez más fuerte ×1.35^bossKills); tick en updateWorld: no reaparece a <14 m del héroe (pospone 3 s), tope por santuario de 4 guardias (exentos del tope global), roamerTimer ahora cuenta vivos+pendientes; respawn() limpia la cola.
- minimap.ts: marcador dorado (rombo) del puesto del mercader.
- page.tsx: MerchantPanel completo (cabecera con retrato/oro/cierre, columna Mercadería con 9 huecos de precio y atenuado si no hay oro, columna Tu mochila con +◈ por unidad, caja de detalle al hover con stats y precio, pies con reglas de la tienda), hud.shop en INITIAL_HUD, texto del menú ("Comercia con Ferran el Mercader… Los enemigos reaparecen en sus puestos…"), ayuda inferior actualizada.
- DEPURACIÓN E2E (agent-browser): (1) tope global de 18 estaba POR DEBAJO del población base (12 guardias+6 errantes) y bloqueaba todos los respawns → guardias exentos con tope por santuario, errantes acotados por guarda de agenda y roamerTimer contando pendientes; (2) puesto y rótulo parentados al root rotatorio del mercader salían desplazados → root fijo en mundo, solo el rig rota, offsets directos; (3) enemigos en estado 'spawn' invulnerable confundían el test → forzado state='idle' antes de matar; (4) rAF estrangulado en headless (~0.1 s de juego por segundo real) → lógica verificada bombeando updateWorld(dt) y forzando composer.render() para capturas.
- VERIFICACIÓN: tsc 0 errores en src/, ESLint limpio, consola sin errores, 331-931 FPS; pruebas pasadas: prompt y apertura con E, compra por DOM (300→230 ◈, elixir apilado ×2), venta (230→242 ◈), cierre con Esc sin pausa, respawn de errante en su punto exacto, respawn de guardia de santuario vivo (4/4), cero respawns tras purificar, reabastecimiento diario con aviso, inventario con I intacto, farol nocturno encendido; capturas en download/mer_menu.png, mer_shop.png, mer_stall_day2.png, mer_stall_night2.png, mer_menu_final.png, mer_regression_inv.png.

Stage Summary:
- AETHERIA añade a Ferran el Mercader: puesto animado junto a la hoguera (toldo a rayas, farol nocturno, rótulo, saludo con la mano), tienda completa de compra/venta con economía por rarezas y reabastecimiento diario; y el mundo ahora repuebla como un MMORPG: cada enemigo vuelve a su punto de spawn tras su tiempo (26-48 s), los santuarios sin purificar se rearman, y Bel'Zaroth despierta solo 140 s después de caer en modo infinito, cada vez más fuerte.

---
Task ID: 6
Agent: main (Super Z)
Task: Personajes GLB reales + pipeline de render moderno ("el personaje parece un Playmobil… mejorar para que se vea mucho más moderno y profesional")

Work Log:
- ASSETS DESCARGADOS a public/assets/models (18 MB, licencia libre Mixamo/CC): readyplayer.me.glb (héroe), Soldier.glb (mercader + fuente de locomoción), Xbot.glb (enemigos), Fox.glb (criaturas, Khronos CC-BY), dungeon_warkarma.glb (ruinas). Michelle.glb descartada (solo trae SambaDance/TPose).
- characters.ts (NUEVO, ~720 líneas): GLTFLoader local + progreso; retarget de locomoción Soldier→readyplayer.me con SkeletonUtils.retargetClip (mapa de nombres tolerante al sanitizado de GLTFLoader 'mixamorig:Hips'→'mixamorigHips'; hip dinámico); REESCRITURA de tracks '.bones[X].*' → 'X.*' para que los clips retargeteados convivan con los horneados en el mixer de escena; HORNEADO de clips de combate sobre el esqueleto real a partir de los CLIPS procedurales del juego (mismas duraciones → hitAt/dur de la jugabilidad intactos) con conversión euler-mundo→local (L' = Pw⁻¹·(qAnim·R_align)·Pw·L0, R_align empírico por dirección hueso→hijo); GlbAnimator con crossfade/LoopOnce/clamp; armas y escudo anclados a los huesos de mano con orientación calculada en espacio mundo (q_mano⁻¹·q_deseado); enemigos = SkeletonUtils.clone + materiales clonados con tinte por variante (goblin verde 1.06 m, arquero hueso 1.5 m, orco rojo 2.14 m, jefe oscuro emisivo 2.95 m) y clips Xbot compartidos horneados a la altura original (bodyY proporcional al escalar); mercader = Soldier clonado con tinte burdeos + saludo horneado; zorros ambientales (Survey/Walk/Run, huyen del héroe); ruinas fusionadas por material (~25 draw calls), normalizadas a 34 m y con piedra estilizada del juego (los materiales originales del GLB salían negros).
- Integración sin romper jugabilidad: Player/Enemy/Merchant aceptan rig visual GLB o procedural (VisualRig como contrato; attachGlb con collectMats/fadeMats/barra de vida recalculados); TODOS los estados usan la misma máquina (dead→'death', hurt→'hurt', roll→'roll', attack→'slash1/2/3/heavy', walk/run/idle/strafe, windup→clip del ataque, greet del mercader); Fallback completo verificado: bloqueando los GLB por red el juego arranca con rigs procedurales.
- PIPELINE MODERNO: ACESFilmicToneMapping (exp 1.06), PCFShadowMap (PCFSoft deprecado en r185), FOV 65 (menú 58), bloom 0.26/0.55 sutil, grading (sat 1.06, grano 0.012, contraste 1.04); terreno PBR: MeshStandardMaterial con splat 2048 px repintado (base natural + FOTO CC0 de césped estampada async + senderos rojos encima) + normalMap de ambientCG ×46; carga con progreso en el velo ("Invocando el héroe… 40%").
- DEPURACIÓN (agent-browser): map=0 del retarget (nombres saneados por GLTFLoader → variantes con/sin ':'), binding '.bones[]' error (requiere SkinnedMesh como raíz → reescritura de nombres de track), espada/escudo flotantes (orientación mundo calculada), ruinas gigantes negras (normalización 34 m + vertexColors perdido en la fusión + materiales metálicos sin IBL → piedra del juego y colocación en la cresta del borde), rAF estrangulado en headless (verificación bombeando updateWorld y forzando composer.render).
- VERIFICACIÓN: tsc 0 errores en src/, ESLint limpio, consola sin errores; 400-1029 FPS; capturas download/glb_*.png (menú, héroe close-up, caminar mocap, tajo con anticipation, combate con goblins verdes + orco rojo + arquero pálido y números de daño, mercader humano tras su puesto con saludo, tienda 100 % operativa, noche con farol, arena con Bel'Zaroth, ruinas en la cresta, fallback procedural).

Stage Summary:
- Adiós al Playmobil: héroe readyplayer.me con mocap retargeteado (Idle/Walk/Run de Soldier), enemigos Xbot clonados con 4 variantes de tinte/escala, Ferran con modelo humano real, zorros que huyen y ruinas-góticas en el horizonte. Pipeline ACES + PBR + bloom sutil + terreno fotográfico. Toda la jugabilidad (combos, esquiva, lock-on, ciclo día/noche, tienda, respawn MMORPG) intacta, con fallback procedural si los GLB no cargan.
