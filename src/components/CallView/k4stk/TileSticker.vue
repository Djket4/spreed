<!--
  - ket4tec: k4stk. Гифка или стикер на плитке вместо камеры и аватара. Один слой на «мою» плитку и на плитки других.
-->

<template>
	<div
		v-if="e && it"
		ref="root"
		class="k4stk-tile"
		:class="{ 'k4stk-fit': fit }"
		:data-sid="own ? state.sid : sid"
		:data-k="e.k"
		:data-id="e.id">
		<img
			v-if="e.k === 's'"
			:key="e.id"
			class="k4stk-s"
			:src="it.src"
			alt=""
			draggable="false"
			:style="{ '--w': it.w * 2 + 'px', aspectRatio: it.w + '/' + it.h }">
		<template v-else>
			<img
				:key="'p' + e.id"
				class="k4stk-p"
				:src="it.pos"
				alt=""
				draggable="false">
			<video
				v-if="fit"
				:key="'b' + e.id"
				class="k4stk-bg"
				:src="it.src"
				:poster="it.pos"
				muted
				loop
				autoplay
				playsinline />
			<video
				:key="e.id"
				class="k4stk-g"
				:src="it.src"
				:poster="it.pos"
				muted
				loop
				autoplay
				playsinline />
		</template>
		<button
			v-if="own"
			class="k4stk-x"
			type="button"
			aria-label="Убрать"
			title="Убрать"
			@click.stop="clear()">
			<svg
				viewBox="0 0 24 24"
				width="16"
				height="16"
				aria-hidden="true"><path
					d="M6 6l12 12M18 6L6 18"
					stroke="currentColor"
					stroke-width="2.4"
					stroke-linecap="round"
					fill="none" /></svg>
		</button>
	</div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ITEMS } from './catalog.js'
import { clear, state } from './useStickers.js'

const props = defineProps({
	/** sessionId владельца плитки (для моей плитки не нужен) */
	sid: { type: String, default: '' },
	own: { type: Boolean, default: false },
})

const e = computed(() => (props.own ? state.mine : state.peers[props.sid]))
const it = computed(() => (e.value ? ITEMS[e.value.id] : null))

const FIT = 1.75 // порог «cover -> contain» по расхождению пропорций гифки и плитки
const root = ref(null)
const box = ref({ w: 0, h: 0 })
const fit = computed(() => {
	const g = it.value
	if (e.value?.k !== 'g' || !g || !box.value.w || !box.value.h) {
		return false
	}
	const a = box.value.w / box.value.h
	const b = g.w / g.h
	return Math.max(a / b, b / a) > FIT
})

let ro = null
/** Плитка = родитель слоя: следим за её размером (а не за слоем, который сам растягивается). */
function observe() {
	ro?.disconnect()
	const tile = root.value?.parentElement
	if (tile) {
		ro = new ResizeObserver(() => {
			box.value = { w: tile.clientWidth, h: tile.clientHeight }
		})
		ro.observe(tile)
	}
}
onMounted(observe)
watch(root, observe)
onBeforeUnmount(() => ro?.disconnect())
</script>

<style lang="scss">
.k4stk-tile {
	position: absolute;
	inset: 0;
	z-index: 1;
	display: grid;
	place-items: center;
	overflow: hidden;
	border-radius: var(--k7-r-tile, 24px);
	container-type: size;
	pointer-events: none;
	animation: k4stk-in .32s cubic-bezier(.2, 1.1, .3, 1) both;

	.k4stk-s {
		width: min(78cqmin, var(--w));
		max-height: 78cqmin;
		object-fit: contain;
		filter: drop-shadow(0 14px 24px #000a);
		-webkit-user-drag: none;
		user-select: none;
	}
	.k4stk-g,
	.k4stk-p {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: 50% 35%;
	}
	.k4stk-bg {
		position: absolute;
		inset: -36px;
		width: calc(100% + 72px);
		height: calc(100% + 72px);
		object-fit: cover;
		filter: blur(22px) brightness(.58) saturate(1.5);
	}
	&.k4stk-fit :is(.k4stk-g, .k4stk-p) {
		object-fit: contain;
		object-position: 50% 50%;
	}
	.k4stk-x {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 3;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: #1a1718b0;
		color: #fff;
		backdrop-filter: blur(10px);
		pointer-events: auto;
		cursor: pointer;
	}
}
// камера и аватар под слоем не нужны: прячем целиком, подпись (имя) остаётся
.k4stk-has :is(.avatar-container, .videoWrapper, .video-background) {
	display: none !important;
}
@keyframes k4stk-in {
	from { opacity: 0; transform: scale(.9); }
	to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
	.k4stk-tile { animation: none; }
}
</style>
