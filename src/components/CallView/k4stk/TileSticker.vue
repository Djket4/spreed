<!--
  - ket4tec: k4stk. Гифка или стикер на плитке вместо камеры и аватара. Один слой на «мою» плитку и на плитки других.
-->

<template>
	<!-- ket4tec (слово владельца 11.11): без «ката» — слой проявляется поверх камеры, смена стикера/гифки — перекрёстный фейд,
		снятие — слой гаснет, камера уже под ним -->
	<Transition name="k4stk-t">
		<div
			v-if="on && e && it"
			ref="root"
			class="k4stk-tile"
			:class="{ 'k4stk-fit': fit }"
			:data-sid="own ? state.sid : sid"
			:data-k="e.k"
			:data-id="e.id">
			<Transition name="k4stk-m">
				<div :key="e.k + e.id" class="k4stk-m">
					<img
						v-if="e.k === 's'"
						class="k4stk-s"
						:src="it.src"
						alt=""
						draggable="false"
						:style="{ '--w': it.w * 2 + 'px', aspectRatio: it.w + '/' + it.h }">
					<template v-else>
						<img
							class="k4stk-p"
							:src="it.pos"
							alt=""
							draggable="false">
						<video
							v-if="fit"
							class="k4stk-bg"
							:src="it.src"
							:poster="it.pos"
							muted
							loop
							autoplay
							playsinline />
						<video
							class="k4stk-g"
							:src="it.src"
							:poster="it.pos"
							muted
							loop
							autoplay
							playsinline />
					</template>
				</div>
			</Transition>
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
	</Transition>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ITEMS } from './catalog.js'
import { clear, state } from './useStickers.js'

const props = defineProps({
	/** sessionId владельца плитки (для моей плитки не нужен) */
	sid: { type: String, default: '' },
	own: { type: Boolean, default: false },
	/** слой разрешён на этой плитке (не боковая панель, не показ экрана) */
	on: { type: Boolean, default: true },
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
	// плитка без камеры: тот же фон, что у обычной (k7call.scss), под стикером
	background: linear-gradient(135deg, var(--k7-tile-a, #3b2f3f), var(--k7-tile-b, #1d1620));
	pointer-events: none;

	.k4stk-m {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}

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
// камера и аватар под слоем не нужны: прячем, когда слой проявился (до того камера видна сквозь фейд); подпись (имя) остаётся
.k4stk-has :is(.avatar-container, .videoWrapper, .video-background) {
	animation: k4stk-hide 1ms .42s forwards;
}
@keyframes k4stk-hide {
	to { visibility: hidden; }
}
// появление слоя: проявление с лёгким приближением; снятие: гаснет
.k4stk-t-enter-active { transition: opacity .4s ease, transform .5s cubic-bezier(.2, 1.1, .3, 1), filter .4s ease; }
.k4stk-t-leave-active { transition: opacity .35s ease, transform .35s ease; }
.k4stk-t-enter-from { opacity: 0; transform: scale(1.06); filter: blur(8px); }
.k4stk-t-leave-to { opacity: 0; transform: scale(.98); }
// смена стикера/гифки: перекрёстный фейд, новое чуть «наплывает»
.k4stk-m-enter-active { transition: opacity .45s ease, transform .55s cubic-bezier(.2, 1.1, .3, 1); }
.k4stk-m-leave-active { transition: opacity .45s ease; }
.k4stk-m-enter-from { opacity: 0; transform: scale(.94); }
.k4stk-m-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
	.k4stk-t-enter-active, .k4stk-t-leave-active, .k4stk-m-enter-active, .k4stk-m-leave-active { transition: opacity .2s linear; }
	.k4stk-t-enter-from, .k4stk-m-enter-from, .k4stk-t-leave-to { transform: none; filter: none; }
	.k4stk-has :is(.avatar-container, .videoWrapper, .video-background) { animation-delay: .2s; }
}
</style>
