<!--
  - ket4tec (NAS_CLOUD#195 п.6): связь с участником пропала — приглушённый шум старого телевизора и «NO SIGNAL»
  - вместо застывшего кадра. Только CSS: одна SVG-текстура (браузер растрирует её один раз и кэширует для всех плиток),
  - двигается слой transform-ом шагами ~12 раз в секунду — это работа композитора, без перерисовки и без JS.
  - При prefers-reduced-motion — неподвижное зерно.
-->

<template>
	<div class="k4-nosig" role="status" :aria-label="label">
		<span class="k4-nosig__osd" aria-hidden="true">NO SIGNAL</span>
	</div>
</template>

<script setup>
defineProps({
	label: { type: String, default: 'Нет связи' },
})
</script>

<style lang="scss">
.k4-nosig {
	position: absolute;
	inset: 0;
	z-index: 1;
	overflow: hidden;
	border-radius: inherit;
	container-type: inline-size;
	display: flex;
	align-items: center;
	justify-content: center;
	background: #cfc8c2;
	pointer-events: none;

	// шум: слой вдвое больше плитки, прыгает по 12 позициям в секунду
	&::before {
		content: '';
		position: absolute;
		inset: -50%;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .1 0 0 0 0 .09 0 0 0 0 .1 0 0 0 1.6 -.45'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
		background-size: 160px 160px;
		opacity: .55;
		animation: k4-nosig 1s steps(1) infinite;
		will-change: transform;
	}

	// строки развёртки, неподвижные
	&::after {
		content: '';
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(0deg, #ffffff00 0 2px, #1d181912 2px 3px);
	}
}

.k4-nosig__osd {
	position: relative;
	z-index: 1;
	padding: .3em .55em;
	border-radius: 4px;
	background: #1d18198c;
	color: #fff;
	font: 700 clamp(9px, 9.5cqi, 26px)/1 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
	letter-spacing: .16em;
	white-space: nowrap;
}

body:not(.k4-light) .k4-nosig { background: #4a4446; }

@keyframes k4-nosig {
	0% { transform: translate(0, 0); }
	8.33% { transform: translate(-31px, 17px); }
	16.66% { transform: translate(23px, -41px); }
	25% { transform: translate(-53px, -11px); }
	33.33% { transform: translate(37px, 29px); }
	41.66% { transform: translate(-13px, -59px); }
	50% { transform: translate(61px, 7px); }
	58.33% { transform: translate(-43px, 47px); }
	66.66% { transform: translate(11px, -23px); }
	75% { transform: translate(-67px, 31px); }
	83.33% { transform: translate(47px, -67px); }
	91.66% { transform: translate(-19px, 53px); }
}

@media (prefers-reduced-motion: reduce) {
	.k4-nosig::before { animation: none; }
}
</style>
