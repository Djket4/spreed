<!--
  - ket4tec: k4draw. Доска в звонке: общий холст на месте главной плитки. Рисуют все (гости — пока разрешает модератор).
  - Холст — тот же слой пометок, что поверх показа, только без кадра: соотношение сторон задаёт открывший.
-->

<template>
	<div class="k4-board" :class="{ 'k4-board--draw': state.mode }" @pointerdown="enter">
		<DrawLayer :key="state.board" :presenter="state.board" board />
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
import { onBeforeUnmount } from 'vue'
import DrawLayer from './DrawLayer.vue'
import { useGetToken } from '../../../composables/useGetToken.ts'
import { callParticipantCollection } from '../../../utils/webrtc/index.js'
import { shoot, snap } from './snapshot.js'
import { boardGone, canDraw, closeBoard, myId, state } from './useDrawing.js'

const token = useGetToken()

/** Тап по доске включает рисование. */
function enter() {
	!state.mode && !state.ask && canDraw() && (state.mode = true)
}

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

// открывший ушёл из звонка, не закрыв доску: через ~9 с её больше нет и у остальных
let miss = 0
const timer = setInterval(() => {
	const sid = state.board
	miss = sid && sid !== myId() && !callParticipantCollection.get(sid) ? miss + 1 : 0
	miss >= 3 && boardGone(sid)
}, 3000)
onBeforeUnmount(() => clearInterval(timer))
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
	> .k4-layer {
		inset: 76px 12px 96px;
		transform: none !important;
	}
	.k4-surf {
		background: var(--k4-board-bg);
		border-radius: 16px;
		box-shadow: 0 0 0 1px #0000000f, 0 6px 24px #00000014;
	}
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
