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
				<K4Face
					v-else
					:stream="p.audio"
					:on="p.on"
					:seed="p.seed"
					:token="token" />
				<!-- ket4tec (NAS_CLOUD#195 п.9): как в полосе звонка — NO SIGNAL без связи, значок вместо красной рамки, имя узкой полосой -->
				<K4NoSignal v-if="p.lost && !k4net.selfLost" />
				<span v-else-if="!p.on" class="k4-micoff" title="Звук отключён">
					<NcIconSvgWrapper :svg="IconMicrophoneOffOutline" :size="14" />
				</span>
				<b>{{ p.name }}</b>
				<!-- ket4tec: журнал звонка (NAS_CLOUD#189); p.id = peerId, как ключ в k4stats.peers -->
				<K4TileStats :peerId="p.me ? 'local' : p.id" compact />
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
	</div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStore } from 'vuex'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import K4TileStats from '../k4log/K4TileStats.vue' // ket4tec
import K4Face from '../shared/k4face/K4Face.vue'
import K4NoSignal from '../shared/K4NoSignal.vue'
import DrawLayer from './DrawLayer.vue'
import IconMicrophoneOffOutline from '../../../../img/material-icons/microphone-off-outline.svg?raw'
import { useGetToken } from '../../../composables/useGetToken.ts'
import { useActorStore } from '../../../stores/actor.ts'
import { callParticipantCollection, localMediaModel } from '../../../utils/webrtc/index.js'
import { k4net, peerLost, phoneStrip } from '../shared/k4peer.js' // ket4tec (NAS_CLOUD#195)
import { bgUrl, canDraw, humans, myId, passBoard, requestCloseBoard, showOf, state } from './useDrawing.js'

const token = useGetToken()

const store = useStore()
const actor = useActorStore()
/** Участники звонка для полосы камер: я первым, дальше остальные. */
const people = computed(() => {
	const me = localMediaModel.attributes
	// ket4tec: без камеры — то же облако синапсов, что в сетке (ключ тип/id как в VideoVue/LocalVideo)
	const mySeed = actor.actorId ? actor.actorType + '/' + actor.actorId : 'me'
	const out = [{ id: 'me', me: true, name: 'Вы', stream: me.videoEnabled && me.localStream, audio: me.localStream, on: !!me.audioEnabled, seed: mySeed, speaking: me.speaking }]
	humans().forEach((m) => {
		const a = m.attributes
		const pp = store.getters.findParticipant(token.value, { sessionId: a.nextcloudSessionId })
		const name = a.name || pp?.displayName || 'Участник'
		const id = a.actorId || pp?.actorId
		const type = a.actorType || pp?.actorType
		out.push({ id: a.peerId, name, stream: a.videoAvailable && !a.videoBlocked && a.stream, audio: a.stream, on: a.audioAvailable !== false, seed: id && type ? type + '/' + id : name, speaking: a.speaking, lost: peerLost(a) })
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
	if (!w || !h) {
		return { root: {}, strip: {} }
	}
	const P = 12, G = 8, DOCK = state.mode ? 64 : 0, land = w > h
	const ar = showOf(state.board)?.ar || 4 / 3
	const bw = w - 2 * P, bh = h - 2 * P - DOCK
	let res = 0, strip = {} // res — место под полосу камер вместе с отступом
	if (n && !land) {
		// ket4tec (NAS_CLOUD#195 п.3, 9): портрет — как под показом: доска главная, квадраты по 3 в ряд под ней (видно 1–2 ряда, дальше листается);
		// док инструментов — своей строкой между доской и квадратами (DrawDock, --k4-db)
		const { sq, rows } = phoneStrip(n)
		const thick = rows * sq + G * (rows - 1)
		res = thick + P
		strip = { top: 'auto', bottom: `${P}px`, height: `${thick}px`, gridTemplateColumns: `repeat(3, ${sq}px)`, gridAutoRows: `${sq}px`, gridAutoFlow: 'row', justifyContent: 'center', alignContent: 'start', overflowY: 'auto' }
	} else if (n) {
		const free = land ? bw - P - bh * ar : bh - P - bw / ar // место рядом с доской во всю высоту (ширину)
		const max = Math.max(land ? 160 : 76, Math.min(free, (land ? w : h) * 0.4))
		// ket4tec (NAS_CLOUD#109 п.6): док инструментов (560 по центру сцены) не должен лежать на нижней плитке полосы
		const under = land && w / 2 + 280 > w - P - max ? DOCK : 0
		const along = (land ? h - under : w) - 2 * P
		let k = 1, tw = 0 // tw — ширина плитки 4:3
		for (let c = 1; c <= 3; c++) {
			const per = Math.ceil(n / c)
			const a = (along - G * (per - 1)) / per // плитка вдоль полосы, чтобы влезли все без прокрутки
			const t = (max - G * (c - 1)) / c // толщина одной линии
			const x = Math.min(t, a) // ket4tec (NAS_CLOUD#159): плитка камеры - квадрат
			if (x > tw + 1) {
				k = c
				tw = x
			}
		}
		tw = Math.floor(Math.max(tw, land ? 120 : 92))
		const th = tw
		const thick = land ? k * tw + G * (k - 1) : k * th + G * (k - 1)
		res = thick + P
		strip = land ? { width: `${thick}px`, bottom: `${P + under}px`, gridTemplateColumns: `repeat(${k}, ${tw}px)`, gridAutoRows: `${tw}px`, overflowY: 'auto' } : { height: `${thick}px`, gridTemplateRows: `repeat(${k}, ${th}px)`, gridAutoColumns: `${tw}px` }
	}
	// ket4tec (NAS_CLOUD#109 п.1, 6): лист меньше поля. «Закрыть доску» — в углу листа, а не поля (--k4-gx);
	// в портрете лист прижат вниз, к доку и квадратам, пустое место уходит вверх (NAS_CLOUD#195)
	const lw = bw - (land ? res : 0), lh = bh - (land ? 0 : res)
	const sw = Math.min(lw, lh * ar)
	return {
		root: land
			? { '--k4-sr': `${res}px`, '--k4-gx': `${(lw - sw) / 2}px`, '--k4-gb': '0px' }
			: { '--k4-st': `${Math.max(0, lh - sw / ar)}px`, '--k4-gx': `${(lw - sw) / 2}px`, '--k4-gb': `${res}px` }, // портрет: лист прижат вниз, к доку и квадратам
		strip,
	}
})

/** «Закрыть доску»: у всех; с изменённым рисунком — сначала тихий снимок. */
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
	--k4-gx: 0px;
	--k4-gb: 0px;
	> .k4-layer {
		inset: calc(12px + var(--k4-st)) calc(12px + var(--k4-sr)) calc(12px + var(--k4-gb)) 12px;
		transform: none !important;
	}
	&.k4-board--draw > .k4-layer { bottom: calc(76px + var(--k4-gb)); }
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
	aspect-ratio: 1; // ket4tec (NAS_CLOUD#159)
	overflow: hidden;
	border-radius: 16px;
	background: linear-gradient(135deg, var(--k7-tile-a, #3b2f3f), var(--k7-tile-b, #1d1620));
	video { width: 100%; height: 100%; object-fit: cover; display: block; }
	video.mirror { transform: scaleX(-1); }
	container-type: inline-size;
	// ket4tec (NAS_CLOUD#195 п.9): подпись — узкая полоса по нижнему краю, лицо не закрывает (как в полосе звонка)
	b {
		position: absolute;
		z-index: 2;
		inset: auto 0 0;
		height: 22px;
		padding: 0 8px;
		overflow: hidden;
		background: linear-gradient(0deg, #140f17b8, #140f1700);
		color: #fff;
		font-size: 12px;
		font-weight: 700;
		line-height: 22px;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	// ket4tec (NAS_CLOUD#112): рамка поверх видео/облака; красной «без микрофона» нет (NAS_CLOUD#195), только говорящий
	&--talk::after { content: ''; position: absolute; z-index: 3; inset: 0; border-radius: inherit; pointer-events: none; box-shadow: inset 0 0 0 3px var(--k7-acc, #a86bff); }
}
.k4-board__close {
	position: absolute;
	z-index: 7;
	top: calc(20px + var(--k4-st));
	right: calc(20px + var(--k4-sr) + var(--k4-gx));
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
</style>
