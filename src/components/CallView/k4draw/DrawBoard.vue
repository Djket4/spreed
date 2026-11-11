<!--
  - ket4tec: k4draw. Доска в звонке: общий холст на месте главной плитки. Рисуют все (гости — пока разрешает модератор).
  - Холст — тот же слой пометок, что поверх показа, только без кадра: соотношение сторон задаёт открывший.
-->

<template>
	<div
		ref="root"
		class="k4-board"
		:class="{ 'k4-board--draw': state.mode, 'k4-board--strip': people.length, 'k4-board--img': state.bg }"
		:style="{ ...(state.bg ? { '--k4-bgimg': `url('${bgUrl(state.bg)}')` } : {}), ...fit.root }">
		<DrawLayer :key="state.board" :presenter="state.board" board />
		<!-- ket4tec (NAS_CLOUD#103 п.42, 53): камеры участников полосой рядом с доской (iPad — сбоку, iPhone — сверху);
			звук идёт отдельно (CallParticipantsAudioPlayer), здесь видео без звука -->
		<div v-if="people.length" class="k4-strip" :style="fit.strip">
			<div
				v-for="p in people"
				:key="p.id"
				class="k4-strip__t"
				:class="{ 'k4-strip__t--talk': p.speaking }">
				<video
					v-if="p.stream"
					:srcObject="p.stream"
					autoplay
					muted
					playsinline
					:class="{ mirror: p.me }" />
				<span v-else class="k4-strip__ini">{{ p.name.slice(0, 1).toUpperCase() }}</span>
				<b>{{ p.name }}</b>
			</div>
		</div>
		<!-- ket4tec (правило 11.11): доска общая — открыл любой, у всех; закрыл любой, кому можно рисовать, — у всех -->
		<button
			v-if="canDraw()"
			type="button"
			class="k4-board__close"
			title="Закрыть доску у всех"
			aria-label="Закрыть доску у всех"
			@click="close">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			<span>Закрыть доску</span>
		</button>
		<div v-if="state.ask" class="k4-board__ask" @pointerdown.stop>
			<b>Сохранить рисунок?</b>
			<span>Снимок доски уйдёт в Файлы, к записи звонка</span>
			<div>
				<button type="button" class="k4-board__no" @click="answer(false)">
					Нет
				</button>
				<button
					type="button"
					class="k4-board__yes"
					:disabled="snap.busy"
					@click="answer(true)">
					Да
				</button>
			</div>
		</div>
	</div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStore } from 'vuex'
import DrawLayer from './DrawLayer.vue'
import { useGetToken } from '../../../composables/useGetToken.ts'
import { callParticipantCollection, localMediaModel } from '../../../utils/webrtc/index.js'
import { shoot, snap } from './snapshot.js'
import { bgUrl, canDraw, closeBoard, myId, passBoard, requestCloseBoard, showOf, state } from './useDrawing.js'

const token = useGetToken()

const store = useStore()
/** Участники звонка для полосы камер: я первым, дальше остальные. */
const people = computed(() => {
	const me = localMediaModel.attributes
	const out = [{ id: 'me', me: true, name: 'Вы', stream: me.videoEnabled && me.localStream, speaking: me.speaking }]
	callParticipantCollection.callParticipantModels.forEach((m) => {
		const a = m.attributes
		const name = a.name || store.getters.findParticipant(token.value, { sessionId: a.nextcloudSessionId })?.displayName || 'Участник'
		out.push({ id: a.peerId, name, stream: a.videoAvailable && !a.videoBlocked && a.stream, speaking: a.speaking })
	})
	return out.length > 1 ? out : []
})

// ket4tec (слово владельца 11.11): камеры заполняют место, которое доска не занимает, — чем меньше участников, тем крупнее;
// много — в 2–3 столбца (на телефоне — строки). Доска не сжимается ради камер, пока им хватает минимума (160 / 76 px).
const root = ref(null)
const box = ref({ w: 0, h: 0 })
let ro = null
onMounted(() => {
	ro = new ResizeObserver(([e]) => {
		box.value = { w: e.contentRect.width, h: e.contentRect.height }
	})
	ro.observe(root.value)
})
const fit = computed(() => {
	const n = people.value.length
	const { w, h } = box.value
	if (!n || !w || !h) {
		return { root: {}, strip: {} }
	}
	const P = 12, G = 8, land = w > h
	const ar = showOf(state.board)?.ar || 4 / 3
	const bw = w - 2 * P, bh = h - 2 * P - (state.mode ? 64 : 0)
	const free = land ? bw - P - bh * ar : bh - P - bw / ar // место рядом с доской во всю высоту (ширину)
	const max = Math.max(land ? 160 : 76, Math.min(free, (land ? w : h) * 0.4))
	const along = (land ? h : w) - 2 * P
	let k = 1, tw = 0 // tw — ширина плитки 4:3
	for (let c = 1; c <= 3; c++) {
		const per = Math.ceil(n / c)
		const a = (along - G * (per - 1)) / per // плитка вдоль полосы, чтобы влезли все без прокрутки
		const t = (max - G * (c - 1)) / c // толщина одной линии
		const x = land ? Math.min(t, a * 4 / 3) : Math.min(t * 4 / 3, a)
		if (x > tw + 1) {
			k = c
			tw = x
		}
	}
	tw = Math.floor(Math.max(tw, land ? 120 : 92))
	const th = Math.floor(tw * 3 / 4)
	const thick = land ? k * tw + G * (k - 1) : k * th + G * (k - 1)
	return {
		root: land ? { '--k4-sr': `${thick + P}px` } : { '--k4-st': `${thick + P}px` },
		strip: land ? { width: `${thick}px`, gridTemplateColumns: `repeat(${k}, ${tw}px)` } : { height: `${thick}px`, gridTemplateRows: `repeat(${k}, ${th}px)`, gridAutoColumns: `${tw}px` },
	}
})

/** «Закрыть доску»: у всех; с рисунком — сначала «Сохранить рисунок?». */
function close() {
	state.mode = false
	requestCloseBoard()
}

// Камеры полосы держим видимыми сами: доска закрывает сетку, и плитка собеседника под ней может быть не смонтирована
// (свёрнутая полоса, своя камера крупно, страница сетки) — тогда RemoteVideoBlocker глушит его видео и в полосе пусто.
const held = new Set() // блокировщики, которым мы добавили видимость
/** Счётчик видимости: +1 каждому участнику звонка, −1 ушедшим (у ушедшего блокировщик уже уничтожен — вызов пустой). */
function hold() {
	const now = new Set(callParticipantCollection.callParticipantModels.map((m) => m.k4VideoBlocker).filter(Boolean))
	now.forEach((b) => held.has(b) || (b.increaseVisibleCounter(), held.add(b)))
	held.forEach((b) => now.has(b) || (b.decreaseVisibleCounter(), held.delete(b)))
}
watch(() => callParticipantCollection.callParticipantModels.length, hold, { immediate: true })

/**
 * «Сохранить рисунок?»
 *
 * @param {boolean} yes сохранить снимок перед закрытием
 */
async function answer(yes) {
	if (yes) {
		await shoot(token.value)
	}
	state.ask = false
	closeBoard()
}

// открывший ушёл из звонка, не закрыв доску (обрыв): через ~9 с доска переходит к следующему в звонке
let miss = 0
const timer = setInterval(() => {
	const sid = state.board
	miss = sid && sid !== myId() && !callParticipantCollection.get(sid) ? miss + 1 : 0
	if (miss >= 3) {
		miss = 0
		passBoard(sid)
	}
	hold() // запасной путь: блокировщик плитки CallView заводит в своём наблюдателе, может позже нашего
	replay()
}, 3000)
/** iOS Safari: видео, созданное пока страница в фоне (доску открыли без нас), само не стартует и после возврата. */
function replay() {
	if (!document.hidden) {
		document.querySelectorAll('.k4-strip video').forEach((v) => v.paused && v.play().catch(() => {}))
	}
}
document.addEventListener('visibilitychange', replay)
onBeforeUnmount(() => {
	document.removeEventListener('visibilitychange', replay)
	clearInterval(timer)
	ro?.disconnect()
	held.forEach((b) => b.decreaseVisibleCounter())
	held.clear()
})
</script>

<style lang="scss">
.k4-board {
	--k4-board-bg: #ffffff;
	position: absolute;
	inset: 0;
	z-index: 5;
	background: var(--k7-bg, var(--color-main-background));
	touch-action: none;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
	// поле доски: сверху без пустой полосы (п.7); снизу место под док инструментов, пока рисую
	--k4-st: 0px;
	--k4-sr: 0px;
	> .k4-layer {
		inset: calc(12px + var(--k4-st)) calc(12px + var(--k4-sr)) 12px 12px;
		transform: none !important;
	}
	&.k4-board--draw > .k4-layer { bottom: 76px; }
	// iPad и компьютер: камеры столбиком справа
	&.k4-board--strip { --k4-sr: 172px; }
	.k4-surf {
		// ket4tec (NAS_CLOUD#91/#92): «Показать всем» — картинка во всю доску, целиком, по центру
		background: var(--k4-bgimg, none) center / contain no-repeat, var(--k4-board-bg);
		border-radius: 16px;
		box-shadow: 0 0 0 1px #0000000f, 0 6px 24px #00000014;
	}
}
.k4-strip {
	position: absolute;
	z-index: 6;
	top: 12px;
	right: 12px;
	bottom: 12px;
	width: 160px;
	display: grid;
	align-content: safe center;
	gap: 8px;
	overflow: auto;
	scrollbar-width: none;
}
.k4-strip__t {
	position: relative;
	flex: none;
	aspect-ratio: 4 / 3;
	overflow: hidden;
	border-radius: 16px;
	background: linear-gradient(135deg, var(--k7-tile-a, #3b2f3f), var(--k7-tile-b, #1d1620));
	video { width: 100%; height: 100%; object-fit: cover; display: block; }
	video.mirror { transform: scaleX(-1); }
	container-type: inline-size;
	// подпись — «нижняя треть», как у плиток звонка (k7call.scss)
	b {
		position: absolute;
		left: 6px;
		bottom: 6px;
		max-width: calc(100% - 12px);
		padding: .4em .85em .4em 1.05em;
		overflow: hidden;
		border-radius: 5px 10px 10px 5px;
		background: linear-gradient(90deg, #140f17eb, #1a1718b8);
		box-shadow: 0 6px 16px #0006;
		color: #fff;
		font-size: clamp(11px, 5.5cqi, 18px);
		font-weight: 700;
		white-space: nowrap;
		text-overflow: ellipsis;
		&::before { content: ''; position: absolute; inset: 0 auto 0 0; width: .3em; background: linear-gradient(135deg, var(--k7-acc2, #5b2a86), var(--k7-acc, #a86bff)); }
	}
	&--talk { box-shadow: inset 0 0 0 3px var(--k7-acc, #a86bff); }
}
.k4-strip__ini {
	position: absolute;
	inset: 0;
	display: grid;
	place-items: center;
	color: #f3eee9;
	font-size: 28px;
	font-weight: 700;
}
.k4-board__close {
	position: absolute;
	z-index: 7;
	top: calc(20px + var(--k4-st));
	right: calc(20px + var(--k4-sr));
	display: flex;
	align-items: center;
	gap: 6px;
	height: 36px;
	padding: 0 14px 0 10px;
	border: 0;
	border-radius: 999px;
	background: #2a2426d9;
	color: #f3eee9;
	font: inherit;
	font-size: 13px;
	font-weight: 600;
	box-shadow: 0 4px 14px #0004, inset 0 0 0 1px #ffffff1a;
	touch-action: manipulation;
	cursor: pointer;
	svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
}
// iPhone и узкие окна (портрет): камеры строкой сверху
@media (max-aspect-ratio: 1/1) {
	.k4-board.k4-board--strip { --k4-sr: 0px; --k4-st: 84px; }
	.k4-strip { left: 12px; bottom: auto; width: auto; height: 76px; grid-auto-flow: column; align-content: normal; justify-content: safe center; }
	.k4-board__close span { display: none; }
	.k4-board__close { padding: 0 9px; }
}

// тёмная тема: доска тёмная
@media (prefers-color-scheme: dark) {
	body:not([data-themes*='light']) .k4-board { --k4-board-bg: #1f1b1d; }
}
body[data-themes*='dark'] .k4-board { --k4-board-bg: #1f1b1d; }

.k4-board__ask {
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	z-index: 8;
	display: grid;
	gap: 6px;
	width: min(320px, calc(100% - 32px));
	padding: 18px 18px 14px;
	border-radius: 24px;
	background: #2a2426f2;
	color: #f3eee9;
	box-shadow: 0 12px 40px #0007;
	text-align: center;
	b { font-size: 17px; }
	span { font-size: 13px; color: #bdb3ad; }
	div { display: flex; gap: 8px; margin-top: 8px; }
	button {
		flex: 1;
		height: 44px;
		border: 0;
		border-radius: 999px;
		font-size: 15px;
		font-weight: 600;
		color: #f3eee9;
		background: #ffffff14;
	}
	.k4-board__yes { background: linear-gradient(135deg, #5b2a86, #a86bff); }
}
</style>
