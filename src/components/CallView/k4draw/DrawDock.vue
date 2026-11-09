<!--
  - ket4tec: k4draw. Шапка и док инструментов режима рисования (заменяют нижнюю панель звонка).
  - Вёрстка и движение — из прототипа talk-draw и гайда §5–§7а.
-->

<template>
	<!-- в body: над верхней панелью звонка, вне её контекста наложения -->
	<Teleport to="body">
		<div class="k4-dockwrap" :style="vars">
			<svg
				width="0"
				height="0"
				style="position:absolute"
				aria-hidden="true">
				<symbol id="k4i-laser" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1" /></symbol>
				<symbol id="k4i-fade" viewBox="0 0 24 24"><path d="M14 3.5l5.5 5.5-8 8H6V11.5z" /><path d="M3 21h2.5M9 21h2.5M15 21h2.5" /></symbol>
				<symbol id="k4i-marker" viewBox="0 0 24 24"><path d="M15 3.5l5.5 5.5-8.5 8.5H6.5V12z" /><path d="M6.5 17.5L4 20M12 21h8" /></symbol>
				<symbol id="k4i-arrow" viewBox="0 0 24 24"><path d="M4.5 19.5C8 13 12 8.5 19 5" /><path d="M13 4.2L19 5l-1.6 5.8" /></symbol>
				<symbol id="k4i-frame" viewBox="0 0 24 24"><rect
					x="3.5"
					y="6"
					width="17"
					height="12"
					rx="3.5" /></symbol>
				<symbol id="k4i-text" viewBox="0 0 24 24"><path d="M2.8 18.5L7.4 6l4.6 12.5M4.5 14.5h5.8M14.3 18.5l3.1-8 3.1 8M15.6 15.8h3.6" /></symbol>
				<symbol id="k4i-eraser" viewBox="0 0 24 24"><path d="M9 20h11" /><path d="M4.6 15.4l9.3-9.3a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L10.6 19.4H8.6z" /><path d="M9 11l5 5" /></symbol>
				<symbol id="k4i-undo" viewBox="0 0 24 24"><path d="M9 13.5L4.5 9 9 4.5" /><path d="M4.5 9H14a5.5 5.5 0 0 1 0 11h-3" /></symbol>
				<symbol id="k4i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></symbol>
				<symbol id="k4i-camera" viewBox="0 0 24 24"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" /><circle cx="12" cy="12.5" r="3.4" /></symbol>
				<symbol id="k4i-trash" viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" /></symbol>
			</svg>

			<header class="k4-dh">
				<div class="k4-ttl">
					<b><i />Пометки видят все</b>
					<span>{{ sub }}</span>
				</div>
				<button
					v-if="presenter"
					class="k4-pill k4-pill--ghost"
					type="button"
					aria-label="Очистить всё"
					@click="clearAll">
					Очистить всё
				</button>
				<button
					ref="snapBtn"
					class="k4-pill k4-pill--ghost"
					type="button"
					:disabled="snap.busy"
					@click="takeSnapshot(token, snapBtn)">
					В выжимку<sup v-if="snap.n"> {{ snap.n }}</sup>
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
						@click="undo">
						<svg class="k4-ico"><use href="#k4i-undo" /></svg>
					</button>
					<button
						class="k4-tb k4-tb--snap"
						type="button"
						aria-label="Снимок"
						title="Снимок: кадр показа с пометками в PNG"
						:disabled="snap.busy"
						@click="downloadSnapshot">
						<svg class="k4-ico"><use href="#k4i-camera" /></svg>
					</button>
					<hr>
					<button
						class="k4-tb k4-tb--close"
						type="button"
						aria-label="Закрыть рисование"
						title="Закрыть рисование (Esc)"
						@click="close">
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
import { downloadSnapshot, snap, takeSnapshot, watchSnaps } from './snapshot.js'
import { clearAll, clearMine, isPresenter, reducedMotion, SP, state, TSIZE, undo } from './useDrawing.js'

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
const sub = computed(() => {
	const t = TOOLS.find((x) => x.id === state.tool)
	return t.sub + (state.tool === 'fade' ? state.ft + ' с' : '') + (state.tool === 'text' ? ' · ' + state.tsz.toUpperCase() + ' · ' + (state.tl ? 'гаснет ' + state.tl + ' с' : 'остаётся') : '')
})
const vars = { '--sp-in': SP.in, '--sp-menu': SP.menu }

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
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))

onMounted(() => {
	place()
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
	--k4-glass: #2a2426b3;
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
	position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 8px; pointer-events: auto;
	padding: calc(env(safe-area-inset-top, 0px) + 8px) 12px 8px;
	background: #141112f5; backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%);
	animation: k4-in .3s ease-out;
}
.k4-ttl {
	flex: 1; min-width: 0; line-height: 1.15;
	b { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 600; letter-spacing: -.012em; }
	b i { width: 10px; height: 10px; border-radius: 50%; background: var(--k4-me); box-shadow: 0 0 10px var(--k4-me); }
	span { font-size: 13px; color: var(--k4-fg3); }
}
.k4-cb {
	flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: #ffffff12; transition: transform .12s ease-out;
	&:active { transform: scale(.9); }
}
.k4-pill {
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
/* телефон: док во всю ширину, кнопки 36, «Снимок» скрыт — крестик закрытия всегда в доке */
@media (max-width: 500px) {
	.k4-dock { left: 12px; right: 12px; width: auto; margin-left: 0; }
	.k4-dockwrap .k4-dock .k4-tools { padding: 0 8px; }
	.k4-dockwrap .k4-dock .k4-tb, .k4-dockwrap .k4-dock .k4-sp { width: 36px; height: 36px; }
	.k4-dockwrap .k4-dock .k4-sp { top: 18px; }
	.k4-dockwrap .k4-dock .k4-tb--snap { display: none; }
}
.k4-fsel.k4-tsel { padding: 0 4px; }
.k4-tools {
	position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 12px;
	hr { width: 1px; height: 28px; margin: 0; border: 0; background: var(--k4-hair); }
}
/* .k4-dock: общий button:not(.button-vue) облака сбрасывает ширину в auto */
.k4-dock .k4-tb {
	z-index: 1; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: var(--k4-fg2); transition: transform .12s ease-out, color .2s;
	&:active { transform: scale(.9); }
	&.sel { color: var(--k4-fg); .k4-ico { stroke: var(--k4-me); } }
	&--close:hover { color: #ff6b81; }
	&:disabled { opacity: .35; }
	sup { position: absolute; right: 2px; top: 3px; min-width: 17px; height: 15px; padding: 0 3px; border-radius: 8px; background: #ffffff26; color: var(--k4-fg); font-weight: 700; font-size: 10px; line-height: 15px; text-align: center; }
}
.k4-sp {
	position: absolute; top: 14px; left: 0; width: 44px; height: 44px; border-radius: 50%; background: #ffffff24; transform: translateX(var(--px, 0)); transition: transform .42s var(--sp-in);
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
