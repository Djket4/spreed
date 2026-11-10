<!--
  - ket4tec: k4draw. Шапка и док инструментов режима рисования (заменяют нижнюю панель звонка).
  - Вёрстка и движение — из прототипа talk-draw и гайда §5–§7а.
-->

<template>
	<!-- в body: над верхней панелью звонка, вне её контекста наложения -->
	<Teleport to="body">
		<div class="k4-dockwrap" :style="[vars, scene]">
			<svg
				width="0"
				height="0"
				style="position:absolute"
				aria-hidden="true">
				<symbol id="k4i-laser" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" /><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" /></symbol>
				<symbol id="k4i-fade" viewBox="0 0 24 24"><path d="M17.5 3l3.5 3.5-8.5 8.5H9v-3.5z" /><path d="M3 20c2-2.5 3.5-2.5 4.5-1s2.5 1.5 4.5-1 3.5-2 5 0" /></symbol>
				<symbol id="k4i-marker" viewBox="0 0 24 24"><path d="M12 2.5l5.5 11.5v6.5h-11V14z" /><path d="M12 2.5v8" /><circle cx="12" cy="12.5" r="1.3" /></symbol>
				<symbol id="k4i-arrow" viewBox="0 0 24 24"><path d="M5.5 18.5l13-13M9 5.5h9.5V15" /></symbol>
				<symbol id="k4i-frame" viewBox="0 0 24 24"><rect
					x="3"
					y="5.5"
					width="18"
					height="13"
					rx="2" /></symbol>
				<symbol id="k4i-text" viewBox="0 0 24 24"><text
					x="12"
					y="17.2"
					text-anchor="middle"
					font-size="15"
					font-weight="600"
					fill="currentColor"
					stroke="none">Aa</text></symbol>
				<symbol id="k4i-eraser" viewBox="0 0 24 24"><path d="M9 20h11" /><path d="M4.6 15.4l9.3-9.3a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L10.6 19.4H8.6z" /><path d="M9 11l5 5" /></symbol>
				<symbol id="k4i-undo" viewBox="0 0 24 24"><path d="M9 13.5L4.5 9 9 4.5" /><path d="M4.5 9H14a5.5 5.5 0 0 1 0 11h-3" /></symbol>
				<symbol id="k4i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></symbol>
				<symbol id="k4i-camera" viewBox="0 0 24 24"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" /><circle cx="12" cy="12.5" r="3.4" /></symbol>
				<symbol id="k4i-trash" viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" /></symbol>
			</svg>

			<header class="k4-dh">
				<div class="k4-ttl">
					<b><i />{{ board ? 'Доска' : 'Пометки видят все' }}</b>
					<span>{{ sub }}</span>
				</div>
				<button
					v-if="mod"
					class="k4-pill k4-pill--ghost"
					type="button"
					:aria-pressed="state.gd"
					title="Модератор: могут ли гости рисовать"
					@click="setGuestsDraw(!state.gd)">
					Гости: {{ state.gd ? 'да' : 'нет' }}
				</button>
				<button
					v-if="canClear"
					class="k4-pill k4-pill--ghost"
					type="button"
					aria-label="Очистить всё"
					@click="clearAll()">
					Очистить всё
				</button>
				<!-- ket4tec: k4draw. Приложение для Мака: пометки поверх всего экрана показывающего -->
				<span v-if="presenter && !board && isMac() && mac.st === 'noapp'">Нет приложения для Мака</span>
				<button
					v-if="presenter && !board && isMac()"
					class="k4-pill k4-pill--ghost"
					type="button"
					:title="mac.st === 'noapp' ? 'Страница скачивания и короткая инструкция по установке' : mac.st === 'launch' ? 'Приложение не отвечает: нажмите ещё раз, чтобы запустить его' : mac.st === 'start' ? 'Когда приложение откроется, нажмите, чтобы подключить его' : 'Пометки поверх всего экрана в приложении для Мака'"
					@click="openMac()">
					{{ mac.st === 'noapp' ? 'Скачать' : macLabel[mac.st] }}
				</button>
				<button
					class="k4-cb"
					type="button"
					aria-label="Очистить своё"
					@click="clearMine">
					<svg class="k4-ico"><use href="#k4i-trash" /></svg>
				</button>
				<button class="k4-pill" type="button" @click="close">
					Готово
				</button>
			</header>

			<div class="k4-fsel" :class="{ on: state.tool === 'fade' }">
				<span>Гаснет через</span>
				<div class="k4-seg" :style="{ '--k': 2, '--i': state.ft === 10 ? 1 : 0 }">
					<i />
					<button type="button" :aria-pressed="state.ft === 3" @click="state.ft = 3">
						3 с
					</button>
					<button type="button" :aria-pressed="state.ft === 10" @click="state.ft = 10">
						10 с
					</button>
				</div>
			</div>

			<div
				class="k4-fsel k4-tsel"
				:class="{ on: state.tool === 'text' }"
				@mousedown.prevent>
				<div class="k4-seg" :style="{ '--k': 3, '--i': TSIZE.indexOf(state.tsz), width: '112px' }">
					<i />
					<button
						v-for="z in TSIZE"
						:key="z"
						type="button"
						:aria-pressed="state.tsz === z"
						@click="state.tsz = z">
						{{ z.toUpperCase() }}
					</button>
				</div>
				<div class="k4-seg" :style="{ '--k': 3, '--i': TL.indexOf(state.tl), width: '210px' }">
					<i />
					<button
						v-for="t in TL"
						:key="t"
						type="button"
						:aria-pressed="state.tl === t"
						@click="state.tl = t">
						{{ t ? t + ' с' : 'Остаётся' }}
					</button>
				</div>
			</div>

			<nav ref="dock" class="k4-dock">
				<div class="k4-tools">
					<i class="k4-sp" :style="{ '--px': px + 'px' }" />
					<button
						v-for="b in TOOLS"
						:key="b.id"
						:ref="(el) => (btns[b.id] = el)"
						class="k4-tb"
						:class="{ sel: state.tool === b.id }"
						type="button"
						:aria-label="b.label"
						@click="pick(b.id)">
						<svg class="k4-ico"><use :href="'#k4i-' + b.id" /></svg>
						<sup v-if="b.id === 'fade'">{{ state.ft }}</sup>
					</button>
					<hr>
					<button
						class="k4-tb"
						type="button"
						aria-label="Отменить"
						:disabled="!state.undo"
						@click="undo()">
						<svg class="k4-ico"><use href="#k4i-undo" /></svg>
					</button>
					<button
						ref="snapBtn"
						class="k4-tb k4-tb--snap"
						type="button"
						aria-label="Снимок"
						:title="board ? 'Снимок доски в Файлы, к записи звонка' : 'Снимок: кадр показа с пометками в Файлы, к записи звонка'"
						:disabled="snap.busy"
						@click="shoot(token, snapBtn)">
						<svg class="k4-ico"><use href="#k4i-camera" /></svg>
						<sup v-if="snap.n">{{ snap.n }}</sup>
					</button>
					<hr>
					<button
						class="k4-tb k4-tb--close"
						type="button"
						:aria-label="board ? 'Закрыть доску' : 'Закрыть рисование'"
						:title="board ? 'Закрыть доску' : 'Закрыть рисование (Esc)'"
						@click="board ? closeBoardBtn() : close()">
						<svg class="k4-ico"><use href="#k4i-close" /></svg>
					</button>
				</div>
			</nav>
		</div>
	</Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useGetToken } from '../../../composables/useGetToken.ts'
import { isMac, mac, macLabel, openMac } from './macBridge.js'
import { shoot, snap, watchSnaps } from './snapshot.js'
import { amMod, canClearAll, clearAll, clearMine, isBoard, isPresenter, reducedMotion, requestCloseBoard, setGuestsDraw, SP, state, TSIZE, undo } from './useDrawing.js'

const TOOLS = [
	{ id: 'laser', label: 'Лазерная указка', sub: 'лазер · след гаснет сам' },
	{ id: 'fade', label: 'Маркер, гаснет', sub: 'маркер · гаснет через ' },
	{ id: 'marker', label: 'Маркер, остаётся', sub: 'маркер · остаётся' },
	{ id: 'arrow', label: 'Стрелка', sub: 'стрелка · остаётся' },
	{ id: 'frame', label: 'Рамка', sub: 'рамка · остаётся' },
	{ id: 'text', label: 'Текст', sub: 'текст · тап по кадру' },
	{ id: 'eraser', label: 'Ластик', sub: 'ластик · только свои' },
]

const TL = [0, 3, 10]
const token = useGetToken()
const snapBtn = ref(null)
const unwatch = watchSnaps()
onBeforeUnmount(unwatch)
const dock = ref(null)
const btns = reactive({})
const px = ref(0)
const presenter = computed(() => isPresenter())
const board = computed(() => !!state.big && state.big === state.board && isBoard(state.keys[state.big]))
const mod = computed(() => amMod())
const canClear = computed(() => (state.undo, state.big, canClearAll()))

/** «Закрыть доску»: своя — у всех (с вопросом о снимке), чужая — только у себя. */
function closeBoardBtn() {
	if (presenter.value) {
		state.mode = false
		requestCloseBoard()
	} else {
		state.mode = false
		state.boardHidden = true
	}
}
const sub = computed(() => {
	const t = TOOLS.find((x) => x.id === state.tool)
	return t.sub + (state.tool === 'fade' ? state.ft + ' с' : '') + (state.tool === 'text' ? ' · ' + state.tsz.toUpperCase() + ' · ' + (state.tl ? 'гаснет ' + state.tl + ' с' : 'остаётся') : '')
})
const vars = { '--sp-in': SP.in, '--sp-menu': SP.menu }
// шапка-капсула живёт в пределах сцены звонка: под шапкой Стола и шапкой беседы, шапка Стола остаётся кликабельной
const scene = reactive({})
/**
 *
 */
function placeScene() {
	const cc = document.getElementById('call-container')?.getBoundingClientRect()
	if (!cc) {
		return
	}
	const tb = document.querySelector('.top-bar')?.getBoundingClientRect()
	scene['--k4-sl'] = Math.max(cc.left, 0) + 12 + 'px'
	scene['--k4-sr'] = Math.max(window.innerWidth - cc.right, 0) + 12 + 'px'
	scene['--k4-st'] = Math.max(tb ? tb.bottom : 0, cc.top) + 12 + 'px'
}
let sceneRO = null

/**
 *
 */
function place() {
	const b = btns[state.tool]
	if (b) {
		px.value = b.offsetLeft
	}
}

/**
 *
 * @param id
 */
function pick(id) {
	state.tool = id
	nextTick(place)
}

/**
 * Закрыть режим рисования: панель и верхняя полоса уходят, пометки живут по своим правилам.
 */
function close() {
	state.mode = false
}

/**
 * Esc закрывает, кроме набора текста на кадре (там Esc отменяет текст).
 *
 * @param {KeyboardEvent} e событие
 */
function onKey(e) {
	if (e.key !== 'Escape' || document.activeElement?.closest?.('.k4-layer')) {
		return
	}
	close()
}
// в фазе захвата: поле чата и диалоги Talk гасят Esc раньше
window.addEventListener('keydown', onKey, true)
onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKey, true)
	window.removeEventListener('resize', placeScene)
	sceneRO?.disconnect()
})

onMounted(() => {
	place()
	placeScene()
	window.addEventListener('resize', placeScene)
	sceneRO = new ResizeObserver(placeScene)
	;[document.getElementById('call-container'), document.querySelector('.top-bar')].forEach((n) => n && sceneRO.observe(n))
	if (reducedMotion()) {
		return
	}
	// блоки дока выезжают пружиной по очереди
	const items = [...dock.value.querySelectorAll('.k4-tb, hr')]
	items.forEach((n, i) => n.animate(
		[{ transform: 'translateY(26px) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }],
		{ duration: 420, delay: 60 + i * 26, easing: SP.in, fill: 'backwards' },
	))
})
</script>

<style lang="scss">
.k4-dockwrap {
	--k4-bg: #141112;
	--k4-fg: #f3eee9;
	--k4-fg2: #bdb3ad;
	--k4-fg3: #857b76;
	--k4-hair: #ffffff14;
	--k4-glass: #2a2426e0;
	--k4-acc: #a86bff;
	--k4-acc2: #5b2a86;
	--k4-grad: linear-gradient(135deg, var(--k4-acc2), var(--k4-acc));
	--k4-me: #b98bff;
	position: fixed;
	inset: 0;
	z-index: 3000;
	visibility: visible; // родитель (панель звонка) скрыт visibility:hidden
	pointer-events: none;
	color: var(--k4-fg);
	font-family: var(--font-face, inherit);
	-webkit-user-select: none;
	user-select: none;

	button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; position: relative; touch-action: manipulation; }
	.k4-ico { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; display: block; }
}
.k4-dh {
	position: absolute; left: var(--k4-sl, 12px); right: var(--k4-sr, 12px); top: var(--k4-st, calc(env(safe-area-inset-top, 0px) + 12px)); max-width: 640px; margin-inline: auto; display: flex; align-items: center; gap: 8px; pointer-events: auto;
	padding: 8px 8px 8px 16px; border-radius: 999px;
	background: var(--k4-glass); backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%);
	box-shadow: inset 0 1px 0 #ffffff1c, inset 0 0 0 1px var(--k4-hair), 0 2px 5px #0004;
	animation: k4-in .3s ease-out;
}
.k4-ttl {
	flex: 1; min-width: 0; line-height: 1.15;
	b { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 600; letter-spacing: -.012em; }
	b i { width: 10px; height: 10px; border-radius: 50%; background: var(--k4-me); box-shadow: 0 0 10px var(--k4-me); }
	span { font-size: 13px; color: var(--k4-fg3); }
}
// тема облака в светлом режиме красит все button белым: держим фон дока
.k4-dockwrap button:not(.k4-pill):not(.k4-cb) { background: transparent !important; }
.k4-dockwrap .k4-cb { background: #ffffff12 !important; }
.k4-dockwrap .k4-pill { background: var(--k4-grad) !important; }
.k4-dockwrap .k4-pill--ghost { background: #ffffff14 !important; }
.k4-dockwrap .k4-cb {
	flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: #ffffff12; transition: transform .12s ease-out;
	&:active { transform: scale(.9); }
}
.k4-dockwrap .k4-pill {
	flex: none; height: 44px; padding: 0 20px; border-radius: 999px; background: var(--k4-grad); color: #fff; font-weight: 700; font-size: 15px; box-shadow: 0 6px 20px #a86bff40; transition: transform .12s ease-out;
	&:active { transform: scale(.94); }
	&--ghost { background: #ffffff14; box-shadow: none; font-size: 14px; padding: 0 16px; }
}
.k4-dock {
	position: absolute; left: 50%; bottom: max(10px, calc(env(safe-area-inset-bottom, 0px) - 2px)); width: 500px; max-width: calc(100% - 24px); height: 72px; margin-left: -250px; border-radius: 999px; pointer-events: auto;
	background: var(--k4-glass); -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%);
	box-shadow: inset 0 1px 0 #ffffff1c, inset 0 0 0 1px var(--k4-hair), 0 2px 5px #0004;
	animation: k4-up .42s var(--sp-in) both;
}
/* телефон: док во всю ширину, кнопки 34; «Снимок» в доке — на телефоне это главный путь */
@media (max-width: 500px) {
	.k4-dh { padding-left: 12px; gap: 6px; }
	.k4-ttl { min-width: 0; }
	.k4-ttl b { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
	.k4-ttl b i { display: inline-block; margin-right: 8px; vertical-align: middle; }
	.k4-ttl span { display: none; }
	.k4-dockwrap .k4-pill--ghost { padding: 0 10px; font-size: 12.5px; }
	.k4-dockwrap .k4-pill:not(.k4-pill--ghost) { padding: 0 14px; }
	.k4-dock { left: 12px; right: 12px; width: auto; margin-left: 0; }
	.k4-dockwrap .k4-dock .k4-tools { padding: 0 8px; }
	.k4-dockwrap .k4-dock .k4-tb, .k4-dockwrap .k4-dock .k4-sp { width: 34px; height: 34px; }
	.k4-dockwrap .k4-dock .k4-sp { top: 19px; }
}
/* custom.css темы красит глобальный .k4-ico плиткой приложения: в доке это значок */
body .k4-dockwrap .k4-ico { background: none !important; box-shadow: none !important; border-radius: 0; position: static; }
.k4-fsel.k4-tsel { padding: 0 4px; }
.k4-tools {
	position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 12px;
	hr { width: 1px; height: 28px; margin: 0; border: 0; background: var(--k4-hair); }
}
/* .k4-dock: общий button:not(.button-vue) облака сбрасывает ширину в auto */
.k4-dock .k4-tb {
	z-index: 1; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--k4-fg2); transition: transform .12s ease-out, color .2s;
	&:active { transform: scale(.9); }
	&.sel { color: #fff; }
	&--close:hover { color: #ff6b81; }
	&:disabled { opacity: .35; }
	sup { position: absolute; right: 2px; top: 3px; min-width: 17px; height: 15px; padding: 0 3px; border-radius: 8px; background: #ffffff26; color: var(--k4-fg); font-weight: 700; font-size: 10px; line-height: 15px; text-align: center; }
}
.k4-sp {
	position: absolute; top: 16px; left: 0; width: 40px; height: 40px; border-radius: 50%; background: var(--k4-grad); box-shadow: 0 4px 14px #a86bff55; transform: translateX(var(--px, 0)); transition: transform .42s var(--sp-in);
}
.k4-fsel {
	position: absolute; left: 50%; bottom: calc(max(10px, env(safe-area-inset-bottom, 0px)) + 82px); display: flex; align-items: center; gap: 6px; height: 48px; padding: 0 4px 0 16px; border-radius: 999px;
	transform: translate(-50%, 10px) scale(.92); opacity: 0; visibility: hidden; pointer-events: auto;
	background: var(--k4-glass); -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%);
	box-shadow: inset 0 1px 0 #ffffff1c, inset 0 0 0 1px var(--k4-hair); font-size: 13.5px; color: var(--k4-fg2); white-space: nowrap;
	transition: transform .2s ease-in, opacity .2s ease-in, visibility 0s .2s;
	&.on { transform: translate(-50%, 0); opacity: 1; visibility: visible; transition: transform .36s var(--sp-menu), opacity .2s; }
}
.k4-seg {
	position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; width: 118px; height: 40px; padding: 3px; border-radius: 999px; background: #ffffff10;
	> i { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / var(--k)); border-radius: 999px; background: var(--k4-grad); transform: translateX(calc(100% * var(--i))); transition: transform .42s var(--sp-in); }
	button { z-index: 1; text-align: center; font-size: 13.5px; font-weight: 600; color: var(--k4-fg2); border-radius: 999px; transition: color .2s; }
	button[aria-pressed=true] { color: #fff; }
}
@keyframes k4-in { from { opacity: 0; transform: translateY(-8px); } }
@keyframes k4-up { from { opacity: 0; transform: translateY(24px) scale(.94); } }
@media (prefers-reduced-motion: reduce) {
	.k4-dh, .k4-dock { animation: none; }
	.k4-sp, .k4-seg > i, .k4-fsel { transition: none; }
}
</style>
