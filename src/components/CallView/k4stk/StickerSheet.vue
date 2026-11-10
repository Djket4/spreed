<!--
  - ket4tec: k4stk. Шторка «Гифки и стикеры»: вкладки, поиск по эмодзи и словам, паки, «Держать».
  - На телефоне — нижняя шторка до 70% высоты, на компьютере — над панелью, до 420 px.
-->

<template>
	<Teleport to="body">
		<!-- ket4tec 9Б: подложка и шторка кончаются над панелью звонка (п.20) — панель видна и нажимается -->
		<div
			v-if="state.open"
			class="k4stk-wrap"
			:style="barStyle"
			@click.self="close">
			<section
				class="k4stk-sheet"
				role="dialog"
				aria-label="Гифки и стикеры"
				:style="dragY ? { translate: '0 ' + dragY + 'px' } : null">
				<!-- п.18: ручка — свайп вниз закрывает -->
				<div
					class="k4stk-grip"
					aria-hidden="true"
					@pointerdown="dragStart"
					@pointermove="dragMove"
					@pointerup="dragEnd"
					@pointercancel="dragEnd" />
				<header class="k4stk-head">
					<div class="k4stk-tabs" role="tablist">
						<button
							v-for="t in TABS"
							:key="t.k"
							type="button"
							role="tab"
							:aria-selected="tab === t.k"
							:class="{ on: tab === t.k }"
							@click="setTab(t.k)">
							{{ t.name }}
						</button>
					</div>
					<button
						v-if="state.mine"
						type="button"
						class="k4stk-clear"
						title="Убрать мою гифку или стикер с плитки"
						@click="clear(); close()">
						Убрать
					</button>
					<button
						type="button"
						class="k4stk-x"
						aria-label="Закрыть"
						title="Закрыть"
						@click="close">
						<svg
							viewBox="0 0 24 24"
							width="20"
							height="20"
							aria-hidden="true"><path
								d="M6 6l12 12M18 6L6 18"
								stroke="currentColor"
								stroke-width="2.2"
								stroke-linecap="round" /></svg>
					</button>
				</header>

				<label class="k4stk-search">
					<svg
						viewBox="0 0 24 24"
						width="18"
						height="18"
						aria-hidden="true"><circle
							cx="11"
							cy="11"
							r="6.5"
							stroke="currentColor"
							stroke-width="2"
							fill="none" /><path
								d="M16 16l4.5 4.5"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round" /></svg>
					<input
						v-model.trim="q"
						type="search"
						placeholder="Эмодзи или слово"
						autocomplete="off"
						enterkeyhint="search"
						@keydown.enter.prevent="$event.target.blur()">
				</label>

				<div class="k4stk-chips">
					<button
						v-for="c in chips"
						:key="c"
						type="button"
						:class="{ on: q && nz(q) === nz(c) }"
						@click="q = q && nz(q) === nz(c) ? '' : c">
						{{ c }}
					</button>
				</div>

				<div v-if="tab === 's'" class="k4stk-packs">
					<button
						v-for="p in PACKS"
						:key="p.id"
						type="button"
						:data-pack="p.id"
						:class="{ on: !q && pack === p.id }"
						@click="pack = p.id; q = ''">
						<img :src="ITEMS[p.s[0][0]].th" alt="">
						{{ p.name }}
					</button>
				</div>

				<div ref="scroller" class="k4stk-body">
					<template v-if="tab === 'g'">
						<div v-if="cols[0].length + cols[1].length" class="k4stk-masonry">
							<div v-for="(col, i) in cols" :key="i">
								<button
									v-for="g in col"
									:key="g.id"
									type="button"
									class="k4stk-item k4stk-gif"
									:class="{ on: state.mine?.id === g.id }"
									data-k="g"
									:data-id="g.id"
									:style="{ aspectRatio: g.w + '/' + g.h }"
									:aria-label="g.tx"
									@click="choose('g', g.id)">
									<img :src="g.pos" loading="lazy" alt="">
									<video
										v-k4vis
										muted
										loop
										playsinline
										preload="none"
										:data-src="g.src"
										@playing="$event.target.classList.add('pl')" />
								</button>
							</div>
						</div>
						<p v-else class="k4stk-empty">
							Ничего не нашлось.<br>Попробуй 😂 или «ура»
						</p>
					</template>
					<template v-else>
						<template v-for="s in sections" :key="s.id">
							<div v-if="q" class="k4stk-cap">
								{{ s.name }} · {{ s.items.length }}
							</div>
							<div class="k4stk-grid">
								<button
									v-for="k in s.items"
									:key="k.id"
									type="button"
									class="k4stk-item k4stk-cell"
									:class="{ on: state.mine?.id === k.id }"
									data-k="s"
									:data-id="k.id"
									:aria-label="'Стикер ' + k.tx"
									@click="choose('s', k.id)">
									<img :src="k.th" loading="lazy" alt="">
								</button>
							</div>
						</template>
						<p v-if="!sections.length" class="k4stk-empty">
							Такого стикера нет.<br>Попробуй 😡 или «класс»
						</p>
					</template>
				</div>

				<footer class="k4stk-foot">
					<!-- п.20: «Держать» без контекста непонятно -->
					<span class="k4stk-cap">Сколько показывать на плитке</span>
					<div class="k4stk-ttl">
						<button
							v-for="t in TTL"
							:key="t.s"
							type="button"
							:data-ttl="t.s"
							:aria-pressed="state.ttl === t.s"
							:class="{ on: state.ttl === t.s }"
							@click="setTtl(t.s)">
							{{ t.name }}
						</button>
					</div>
				</footer>
			</section>
		</div>
	</Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CHIPS_GIF, CHIPS_STK, GIFS, hit, ITEMS, PACKS } from './catalog.js'
import { clear, pick, setTtl, state } from './useStickers.js'

const TABS = [{ k: 'g', name: 'Гифки' }, { k: 's', name: 'Стикеры' }]
const TTL = [{ s: 15, name: '15 с' }, { s: 60, name: '1 мин' }, { s: 0, name: 'Пока не уберу' }]
const nz = (x) => x.replace(/️/g, '').toLowerCase()

const tab = ref('g')
const q = ref('')
const pack = ref(PACKS[0].id)
const chips = computed(() => (tab.value === 'g' ? CHIPS_GIF : CHIPS_STK))

/**
 * @param {string} k вкладка
 */
function setTab(k) {
	tab.value = k
	q.value = ''
}

// Гифки: две колонки по реальным пропорциям (кладём в самую низкую)
const cols = computed(() => {
	const c = [[], []]
	const h = [0, 0]
	GIFS.map(([id]) => ITEMS[id]).filter((g) => hit(q.value, g.tx)).forEach((g) => {
		const i = h[0] <= h[1] ? 0 : 1
		c[i].push(g)
		h[i] += g.h / g.w
	})
	return c
})
// Стикеры: без запроса — выбранный пак, с запросом — совпадения по всем
const sections = computed(() => PACKS
	.filter((p) => q.value || p.id === pack.value)
	.map((p) => ({ id: p.id, name: p.name, items: p.s.map(([id]) => ITEMS[id]).filter((k) => hit(q.value, k.tx + ' ' + p.name)) }))
	.filter((s) => s.items.length))

/**
 *
 */
function close() {
	state.open = false
}
/**
 * Как в прототипе: выбор (и повторный тап = убрать) закрывает шторку.
 *
 * @param k
 * @param id
 */
function choose(k, id) {
	pick(k, id)
	close()
}
const onKey = (e) => e.key === 'Escape' && state.open && close()
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
watch(() => state.open, (o) => {
	if (o) {
		q.value = ''
		measureBar()
	}
})

// п.20: шторка телепортирована в body, --bottom-bar-height звонка сюда не наследуется — меряем панель сами
const barStyle = ref(null)
/**
 *
 */
function measureBar() {
	// у плиток тоже есть .bottom-bar (VideoBottomBar, LocalVideo): берём панель звонка по её кнопкам
	const bar = document.querySelector('#call-container .bottom-bar-call-controls')?.closest('.bottom-bar')
	const top = bar?.getBoundingClientRect().top
	barStyle.value = top > 0 && top < window.innerHeight
		? { '--k4s-bar': Math.round(window.innerHeight - top) + 'px', '--k4s-safe': '0px' }
		: null
}

// п.18: свайп вниз по ручке
const dragY = ref(0)
let y0 = null
/**
 * @param {PointerEvent} e
 */
function dragStart(e) {
	y0 = e.clientY
	e.target.setPointerCapture?.(e.pointerId)
}
/**
 * @param {PointerEvent} e
 */
function dragMove(e) {
	if (y0 !== null) {
		dragY.value = Math.max(0, e.clientY - y0)
	}
}
/**
 *
 */
function dragEnd() {
	if (dragY.value > 80) {
		close()
	}
	y0 = null
	dragY.value = 0
}

// Превью играют, только пока видны
let io = null
/**
 *
 */
function getIo() {
	return io || (io = new IntersectionObserver((es) => es.forEach((e) => {
		const v = e.target
		if (e.isIntersecting) {
			v.getAttribute('src') || (v.src = v.dataset.src)
			v.play().catch(() => {})
		} else {
			v.pause()
		}
	}), { rootMargin: '120px 0px' }))
}
onBeforeUnmount(() => io?.disconnect())
const vVisible = {
	mounted: (el) => getIo().observe(el),
	unmounted: (el) => io?.unobserve(el),
}
const vK4vis = vVisible
</script>

<style lang="scss">
.k4stk-wrap {
	position: fixed;
	inset: 0 0 var(--k4s-bar, 0px);
	z-index: 10000;
	background: transparent;
}
.k4stk-sheet {
	--k4s-pill: var(--k7-pill, #ffffff1f);
	position: fixed;
	left: 50%;
	bottom: calc(var(--k4s-bar, 96px) + 8px);
	transform: translateX(-50%);
	box-sizing: border-box;
	width: min(420px, calc(100vw - 16px));
	max-height: min(560px, calc(100dvh - var(--k4s-bar, 96px) - 24px));
	display: flex;
	flex-direction: column;
	padding: 0 12px 10px;
	border-radius: 28px;
	// п.19: чистый фон темы вместо мутного стекла над видео
	background: var(--k7-bg2, #242021);
	box-shadow: inset 0 0 0 1px var(--k7-line2, #ffffff1f), 0 12px 32px #0005;
	color: var(--k7-fg, #f3eee9);
	font-family: var(--k7-font, 'Medeo Sans', system-ui, sans-serif);
	overflow: hidden;
	animation: k4stk-sheet-in .34s cubic-bezier(.2, 1.1, .3, 1) both;

	button {
		font: inherit;
		color: inherit;
		border: 0;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.k4stk-grip {
		flex: none;
		height: 22px;
		margin: 0 -12px;
		touch-action: none;
		cursor: grab;
		&::before { content: ''; display: block; width: 40px; height: 5px; margin: 8px auto 0; border-radius: 3px; background: color-mix(in srgb, var(--k7-fg, #f3eee9) 28%, transparent); }
	}
	.k4stk-x {
		flex: none;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border-radius: 999px;
		background: var(--k4s-pill);
		color: var(--k7-fg, #f3eee9);
	}
	.k4stk-head {
		display: flex;
		gap: 8px;
		align-items: center;
		flex: none;
		margin-bottom: 8px;
	}
	.k4stk-tabs, .k4stk-ttl {
		display: flex;
		flex: 1;
		min-width: 0;
		height: 44px;
		padding: 3px;
		border-radius: 999px;
		background: var(--k4s-pill);
		button {
			flex: 1;
			padding: 0 10px;
			border-radius: 999px;
			background: none;
			font-size: 14px;
			font-weight: 600;
			color: var(--k7-fg2, #bdb3ad);
			white-space: nowrap;
			transition: color .2s, background .2s;
			&.on {
				background: var(--k7-grad, linear-gradient(135deg, #5b2a86, #a86bff));
				color: #fff;
			}
		}
	}
	.k4stk-clear {
		flex: none;
		height: 44px;
		padding: 0 18px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--k7-dng, #e5453d) 22%, transparent);
		font-size: 15px;
		font-weight: 600;
	}
	.k4stk-search {
		display: flex;
		flex: none;
		align-items: center;
		gap: 8px;
		height: 56px;
		margin-bottom: 8px;
		padding: 0 18px;
		border-radius: 999px;
		// п.19: поле поиска видно на фоне шторки
		background: var(--k7-bg, #1a1718);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--k7-fg, #f3eee9) 22%, transparent);
		color: var(--k7-fg2, #bdb3ad);
		&:focus-within { box-shadow: inset 0 0 0 2px var(--k7-acc, #a86bff); }
		input {
			flex: 1;
			min-width: 0;
			height: 40px;
			margin: 0;
			padding: 0;
			border: 0;
			outline: none;
			background: none;
			box-shadow: none;
			color: var(--k7-fg, #f3eee9);
			font: inherit;
			font-size: 16px;
		}
	}
	.k4stk-chips, .k4stk-packs {
		display: flex;
		flex: none;
		gap: 6px;
		padding-bottom: 8px;
		overflow-x: auto;
		scrollbar-width: none;
		&::-webkit-scrollbar { display: none; }
		button {
			flex: none;
			display: flex;
			align-items: center;
			gap: 8px;
			height: 40px;
			min-width: 44px;
			justify-content: center;
			padding: 0 12px;
			border-radius: 999px;
			background: var(--k4s-pill);
			font-size: 19px;
			&.on { background: color-mix(in srgb, var(--k7-acc, #a86bff) 30%, transparent); }
		}
	}
	.k4stk-packs button {
		height: 44px;
		padding: 0 14px 0 5px;
		font-size: 13.5px;
		font-weight: 600;
		img { width: 34px; height: 34px; object-fit: contain; }
	}
	.k4stk-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		overscroll-behavior: contain;
	}
	.k4stk-masonry {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		> div { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
	}
	.k4stk-gif {
		position: relative;
		display: block;
		width: 100%;
		padding: 0;
		border-radius: 16px;
		overflow: hidden;
		background: var(--k7-bg3, #2c2627);
		img, video {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			// п.21: гифка целиком, без обрезки
			object-fit: contain;
		}
		video { opacity: 0; transition: opacity .25s; &.pl { opacity: 1; } }
	}
	.k4stk-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
		gap: 4px;
	}
	.k4stk-cell {
		aspect-ratio: 1;
		display: grid;
		place-items: center;
		padding: 0;
		border-radius: 18px;
		background: none;
		img { width: 86%; height: 86%; object-fit: contain; pointer-events: none; }
	}
	.k4stk-item.on { box-shadow: inset 0 0 0 3px var(--k7-acc, #a86bff); background: color-mix(in srgb, var(--k7-acc, #a86bff) 18%, transparent); }
	.k4stk-gif.on { box-shadow: 0 0 0 3px var(--k7-acc, #a86bff); }
	.k4stk-cap { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--k7-fg2, #bdb3ad); }
	.k4stk-body .k4stk-cap { padding: 8px 4px 4px; }
	.k4stk-empty { margin: 32px 0; text-align: center; color: var(--k7-fg2, #bdb3ad); }
	.k4stk-foot {
		display: flex;
		flex: none;
		align-items: center;
		margin: 8px -12px -10px;
		flex-wrap: wrap;
		gap: 6px;
		padding: 8px 12px calc(10px + var(--k4s-safe, env(safe-area-inset-bottom, 0px)));
		background: var(--k7-bg2, #242021);
		> .k4stk-cap { flex: 1 0 100%; padding-inline-start: 4px; text-transform: none; letter-spacing: 0; font-size: 13px; font-weight: 600; }
		box-shadow: 0 -1px 0 var(--k7-line, #ffffff12);
		.k4stk-ttl { height: 40px; button { font-size: 13px; } }
	}
}
@keyframes k4stk-sheet-in {
	from { opacity: 0; transform: translateX(-50%) translateY(14px) scale(.97); }
	to { opacity: 1; transform: translateX(-50%); }
}
@media (max-width: 600px) {
	.k4stk-sheet {
		left: 0;
		right: 0;
		bottom: var(--k4s-bar, 0px);
		width: auto;
		max-height: calc(100dvh - var(--k4s-bar, 0px) - 64px);
		transform: none;
		border-radius: 28px 28px 0 0;
		height: min(70dvh, 640px);
		animation-name: k4stk-sheet-in-m;
	}
}
@keyframes k4stk-sheet-in-m {
	from { transform: translateY(100%); }
	to { transform: none; }
}
@media (prefers-reduced-motion: reduce) {
	.k4stk-sheet { animation: none; }
}
</style>
