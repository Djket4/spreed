<!--
  - ket4tec: k4draw. Шапка и док инструментов режима рисования (заменяют нижнюю панель звонка).
  - Вёрстка и движение — из прототипа talk-draw и гайда §5–§7а.
-->

<template>
	<!-- в body: над верхней панелью звонка, вне её контекста наложения -->
	<Teleport to="body">
		<div class="k4-dockwrap" :class="{ 'k4-dockwrap--side': sidebar.show }" :style="[vars, scene]">
			<svg
				width="0"
				height="0"
				style="position:absolute"
				aria-hidden="true">
				<symbol id="k4i-laser" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" /><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" /></symbol>
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
				<symbol id="k4i-more" viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></symbol>
				<symbol id="k4i-trash" viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" /></symbol>
			</svg>

			<!-- ket4tec (владелец 11.11): линия указки гаснет через 3,5 с, выбора нет (useDrawing state.ft) -->
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

			<!-- ket4tec: k4draw. Свой цвет и толщина — поповер по точке в доке, одинаково на iPhone, iPad и компьютере (п.11, 12) -->
			<div
				class="k4-style"
				:class="{ up: state.tool === 'laser' || state.tool === 'text', open: pal }"
				@mousedown.prevent
				@click="$event.target.closest('.k4-sw') && (pal = false)">
				<button
					type="button"
					class="k4-sw k4-sw--auto"
					aria-label="Цвет автоматически"
					:aria-pressed="!state.col"
					:style="{ '--c': meColor() }"
					@click="setColor('')" />
				<button
					v-for="c in PALETTE"
					:key="c"
					type="button"
					class="k4-sw"
					:aria-label="'Цвет ' + c"
					:aria-pressed="state.col === c"
					:style="{ '--c': c }"
					@click="setColor(c)" />
				<div class="k4-seg k4-wsz" :style="{ '--k': 3, '--i': WSZ.indexOf(state.sz) }">
					<i />
					<button
						v-for="w in WSZ"
						:key="w"
						type="button"
						:aria-label="'Толщина ' + w"
						:aria-pressed="state.sz === w"
						@click="setSize(w)">
						<b :style="{ height: w * 1.6 + 1 + 'px' }" />
					</button>
				</div>
			</div>

			<!-- ket4tec (п.8, 12–14, 38): вместо верхней шапки — меню «Ещё» у дока; на iPhone и iPad одинаково -->
			<div
				class="k4-more"
				:class="{ open: more }"
				@mousedown.prevent>
				<button
					v-if="mod"
					type="button"
					:aria-pressed="state.gd"
					title="Модератор: могут ли гости рисовать"
					@click="setGuestsDraw(!state.gd)">
					Гости рисуют: {{ state.gd ? 'да' : 'нет' }}
				</button>
				<button type="button" @click="clearMine(); more = false">
					Стереть своё
				</button>
				<button
					v-if="canClear"
					type="button"
					@click="clearAll(); more = false">
					Стереть всё у всех
				</button>
				<!-- ket4tec: k4draw. Приложение для Мака: пометки поверх всего экрана показывающего -->
				<button
					v-if="presenter && !board && isMac()"
					type="button"
					:title="mac.st === 'noapp' ? 'Страница скачивания и короткая инструкция по установке' : mac.st === 'launch' ? 'Приложение не отвечает: нажмите ещё раз, чтобы запустить его' : mac.st === 'start' ? 'Когда приложение откроется, нажмите, чтобы подключить его' : 'Пометки поверх всего экрана в приложении для Мака'"
					@click="openMac()">
					{{ mac.st === 'noapp' ? 'Приложение для Мака: скачать' : macLabel[mac.st] }}
				</button>
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
						:title="b.label"
						@click="pick(b.id)">
						<svg class="k4-ico"><use :href="'#k4i-' + b.id" /></svg>
					</button>
					<button
						class="k4-tb k4-dot"
						type="button"
						aria-label="Цвет и толщина"
						:aria-expanded="pal"
						@click="pal = !pal; more = false">
						<i :style="{ background: meColor() }" />
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
					<button
						class="k4-tb"
						type="button"
						aria-label="Ещё"
						:aria-expanded="more"
						@click="more = !more; pal = false">
						<svg class="k4-ico"><use href="#k4i-more" /></svg>
					</button>
					<hr>
					<button
						class="k4-tb k4-tb--close"
						type="button"
						:aria-label="closeLabel"
						:title="closeLabel"
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
import { useSidebarStore } from '../../../stores/sidebar.ts'
import { isMac, mac, macLabel, openMac } from './macBridge.js'
import { shoot, snap, watchSnaps } from './snapshot.js'
import { amMod, canClearAll, clearAll, clearMine, isBoard, isPresenter, myColor, PALETTE, reducedMotion, requestCloseBoard, setColor, setGuestsDraw, setSize, SP, state, TSIZE, undo, WSZ } from './useDrawing.js'

const TOOLS = [
	{ id: 'laser', label: 'Указка: тап — мигающая точка, ведёшь — линия, гаснет сама', sub: 'указка · тап — точка, линия гаснет через ' },
	{ id: 'marker', label: 'Маркер, остаётся', sub: 'маркер · остаётся' },
	{ id: 'arrow', label: 'Стрелка', sub: 'стрелка · остаётся' },
	{ id: 'frame', label: 'Рамка', sub: 'рамка · остаётся' },
	{ id: 'text', label: 'Текст', sub: 'текст · тап по кадру' },
	{ id: 'eraser', label: 'Ластик', sub: 'ластик · только свои' },
]

const TL = [0, 3, 10]
const pal = ref(false) // поповер цвета и толщины
const more = ref(false) // меню «Ещё»
const meColor = () => myColor()
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

/** «Закрыть доску»: у всех, кто бы её ни открыл (правило 11.11); с рисунком — сначала «Сохранить рисунок?». */
function closeBoardBtn() {
	state.mode = false
	requestCloseBoard()
}
const closeLabel = computed(() => (board.value ? 'Закрыть доску у всех' : 'Закрыть рисование (Esc)'))
const vars = { '--sp-in': SP.in, '--sp-menu': SP.menu }
const sidebar = useSidebarStore()
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
	// док стоит над панелью звонка: она теперь видна и в режиме рисования (п.9)
	const bb = document.querySelector('#call-container > .bottom-bar')?.getBoundingClientRect()
	scene['--k4-sb'] = Math.max(0, window.innerHeight - (bb ? bb.top : window.innerHeight)) + 'px'
	document.documentElement.style.setProperty('--k4-sb', scene['--k4-sb']) // для тостов на телефоне (k7ui.scss)
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
	pal.value = false
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
	;[document.getElementById('call-container'), document.querySelector('.top-bar'), document.querySelector('#call-container > .bottom-bar')].forEach((n) => n && sceneRO.observe(n))
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
// ket4tec (NAS_CLOUD#106 п.2): у модератора на углу «Покинуть» — стрелка меню «Завершить звонок для всех» (k7call.scss,
// .leave-call-actions--split). Она торчит прямо под крестиком дока, а её меню открывается поверх дока: промах по крестику
// и повторное касание того же места = «Завершить звонок для всех». Пока док на экране, стрелку прячем; «Покинуть» остаётся.
body:has(.k4-dockwrap) #call-container .leave-call-actions--split > div.action-item { visibility: hidden !important; pointer-events: none !important; }
// ket4tec (NAS_CLOUD#109 п.10): на телефоне боковая панель во весь экран — док не должен лежать поверх неё
@media (max-width: 512px) { .k4-dockwrap--side { display: none; } }
// тема облака в светлом режиме красит все button белым: держим фон дока
.k4-dockwrap button:not(.k4-sw) { background: transparent !important; }
// ket4tec (п.9, 36): док над панелью звонка, по центру сцены звонка (не окна) — на одной оси с доской и при открытой боковой панели
.k4-dock {
	position: absolute; left: var(--k4-sl, 12px); right: var(--k4-sr, 12px); bottom: calc(var(--k4-sb, 0px) + 8px); width: min(560px, calc(100% - var(--k4-sl, 12px) - var(--k4-sr, 12px))); height: 56px; margin-inline: auto; border-radius: 999px; pointer-events: auto;
	background: var(--k4-glass); -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%);
	box-shadow: inset 0 1px 0 #ffffff1c, inset 0 0 0 1px var(--k4-hair), 0 2px 5px #0004;
	animation: k4-up .42s var(--sp-in) both;
}
/* телефон: 12 кнопок в ширину экрана — кнопки 30 */
@media (max-width: 500px) {
	.k4-dockwrap .k4-dock .k4-tools { padding: 0 6px; }
	.k4-dockwrap .k4-dock .k4-tb, .k4-dockwrap .k4-dock .k4-sp { width: 30px; height: 30px; }
	.k4-dockwrap .k4-dock .k4-sp { top: 13px; }
	.k4-dockwrap .k4-dock .k4-tb sup { right: -8px; top: -11px; } // кнопка 30: бейдж целиком над значком (NAS_CLOUD#109 п.2)
	.k4-tools hr { display: none; }
	.k4-dockwrap .k4-style .k4-sw { width: 30px; height: 30px; }
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
	// счётчик снимков — бейдж за краем значка, не поверх него (п.10/41)
	sup { position: absolute; right: -9px; top: -7px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--k4-acc); color: #fff; font-weight: 700; font-size: 10px; line-height: 16px; text-align: center; box-shadow: 0 0 0 2px #2a2426; }
}
.k4-sp {
	position: absolute; top: 8px; left: 0; width: 40px; height: 40px; border-radius: 50%; background: var(--k4-grad); box-shadow: 0 4px 14px #a86bff55; transform: translateX(var(--px, 0)); transition: transform .42s var(--sp-in);
}
.k4-fsel {
	position: absolute; left: calc(50% + (var(--k4-sl, 0px) - var(--k4-sr, 0px)) / 2); bottom: calc(var(--k4-sb, 0px) + 72px); display: flex; align-items: center; gap: 6px; height: 48px; padding: 0 4px 0 16px; border-radius: 999px;
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
.k4-style, .k4-more {
	position: absolute; left: calc(50% + (var(--k4-sl, 0px) - var(--k4-sr, 0px)) / 2); bottom: calc(var(--k4-sb, 0px) + 72px); display: none; align-items: center; pointer-events: auto;
	transform: translateX(-50%);
	background: var(--k4-glass); -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%);
	box-shadow: inset 0 1px 0 #ffffff1c, inset 0 0 0 1px var(--k4-hair), 0 8px 24px #0005;
	&.open { display: flex; }
	&.up { bottom: calc(var(--k4-sb, 0px) + 128px); }
}
// цвета и толщина: 9 цветов в ряд, толщина строкой ниже
.k4-style { width: min(340px, calc(100% - 24px)); flex-wrap: wrap; justify-content: center; gap: 8px 6px; padding: 8px; border-radius: 24px; }
.k4-style .k4-wsz { flex-basis: 100%; width: 100%; margin-left: 0; }
.k4-more {
	flex-direction: column; align-items: stretch; gap: 2px; min-width: 220px; padding: 6px; border-radius: 20px;
	button { height: 44px; padding: 0 14px; border-radius: 14px; text-align: start; font-size: 15px; font-weight: 600; color: var(--k4-fg); }
}
.k4-dockwrap .k4-style .k4-sw {
	flex: none; width: 28px; height: 28px; min-width: 0; min-height: 0; padding: 0; border: 0; border-radius: 50%; background: var(--c) !important; box-shadow: inset 0 0 0 1px #0004; transition: transform .12s ease-out;
	&[aria-pressed=true] { box-shadow: 0 0 0 2px var(--k4-bg), 0 0 0 4px #fff; }
	&--auto { background: conic-gradient(var(--c) 0 50%, #ffffff30 0) !important; }
	&:active { transform: scale(.88); }
}
.k4-style .k4-wsz {
	height: 34px;
	button { display: grid; place-items: center; }
	b { display: block; width: 18px; border-radius: 3px; background: currentColor; }
}
.k4-dock .k4-dot i { width: 20px; height: 20px; border-radius: 50%; box-shadow: 0 0 0 2px #fff, inset 0 0 0 1px #0004; }
@keyframes k4-in { from { opacity: 0; transform: translateY(-8px); } }
@keyframes k4-up { from { opacity: 0; transform: translateY(24px) scale(.94); } }
@media (prefers-reduced-motion: reduce) {
	.k4-dock { animation: none; }
	.k4-sp, .k4-seg > i, .k4-fsel { transition: none; }
}
</style>
