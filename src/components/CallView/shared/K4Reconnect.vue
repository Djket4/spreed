<!--
  - ket4tec (слово владельца 11.11): связь с участником пропала — вместо застывшего кадра плашка во всю плитку
  - «Переподключается…», видна всем в звонке; у себя — «Нет связи, переподключаемся».
-->

<template>
	<Transition name="k4-recon" appear>
		<div class="k4-recon" role="status">
			<svg class="k4-recon__ic" viewBox="0 0 48 48" aria-hidden="true">
				<defs>
					<linearGradient
						id="k4-recon-g"
						x1="0"
						y1="0"
						x2="1"
						y2="1">
						<stop offset="0" stop-color="var(--k7-acc2, #5b2a86)" />
						<stop offset="1" stop-color="var(--k7-acc, #a86bff)" />
					</linearGradient>
				</defs>
				<circle
					class="a0"
					cx="24"
					cy="36"
					r="3.2" />
				<path class="a1" d="M17 29.5a10 10 0 0 1 14 0" />
				<path class="a2" d="M11.5 24a17.5 17.5 0 0 1 25 0" />
				<path class="a3" d="M6 18.5a25 25 0 0 1 36 0" />
			</svg>
			<b>{{ title }}</b>
			<span v-if="sub">{{ sub }}</span>
		</div>
	</Transition>
</template>

<script setup>
defineProps({
	title: { type: String, required: true },
	sub: { type: String, default: '' },
})
</script>

<style lang="scss">
.k4-recon {
	position: absolute;
	inset: 0;
	z-index: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 6px;
	padding: 12px;
	border-radius: inherit;
	container-type: size;
	background: radial-gradient(120% 90% at 50% 40%, #2a2030f2, #140f17f7);
	color: #fff;
	text-align: center;
	pointer-events: none;
	b { font-size: clamp(14px, 7cqmin, 26px); font-weight: 700; }
	span { font-size: clamp(11px, 4.2cqmin, 16px); color: #ffffffb3; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
.k4-recon__ic {
	width: clamp(36px, 22cqmin, 96px);
	height: auto;
	margin-bottom: 4px;
	fill: none;
	stroke: url(#k4-recon-g);
	stroke-width: 3.4;
	stroke-linecap: round;
	.a0 { fill: url(#k4-recon-g); stroke: none; }
	// дуги загораются по очереди — «ищет сеть»
	.a1, .a2, .a3 { opacity: .18; animation: k4-recon-arc 1.6s ease-in-out infinite; }
	.a2 { animation-delay: .2s; }
	.a3 { animation-delay: .4s; }
}
@keyframes k4-recon-arc {
	0%, 15% { opacity: .18; }
	40%, 70% { opacity: 1; }
	100% { opacity: .18; }
}
.k4-recon-enter-active, .k4-recon-leave-active { transition: opacity .35s ease; }
.k4-recon-enter-from, .k4-recon-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
	.k4-recon__ic :is(.a1, .a2, .a3) { animation: none; opacity: .7; }
}
</style>
