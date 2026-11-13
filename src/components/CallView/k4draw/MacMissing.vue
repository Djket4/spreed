<!--
  - ket4tec: k4draw. Плашка «Приложение не найдено»: схема k4draw:// не сработала.
-->

<template>
	<Teleport to="body">
		<div v-if="mac.st === 'noapp'" class="k4-missing" role="alertdialog" aria-label="Приложение не найдено">
			<div class="k4-missing__title">
				Приложение не найдено
			</div>
			<div class="k4-missing__text">
				Скачайте его и один раз откройте вручную. После этого кнопка «Рисовать на экране» будет запускать его сама.
			</div>
			<div class="k4-missing__row">
				<a class="k4-missing__dl" :href="MAC_DL" target="_blank" rel="noopener">Скачать</a>
				<button type="button" @click="connectAnyway()">
					Уже установлено
				</button>
				<button type="button" @click="closeMissing()">
					Закрыть
				</button>
			</div>
		</div>
	</Teleport>
</template>

<script setup>
import { closeMissing, connectAnyway, MAC_DL, mac } from './macBridge.js'
</script>

<style lang="scss" scoped>
.k4-missing {
	position: fixed;
	left: 50%;
	bottom: 96px;
	transform: translateX(-50%);
	z-index: 100000;
	width: min(380px, calc(100vw - 32px));
	padding: 16px 18px;
	border-radius: 16px;
	background: var(--color-main-background, #fff);
	color: var(--color-main-text, #222);
	box-shadow: 0 8px 32px rgba(0, 0, 0, .35);
	display: flex;
	flex-direction: column;
	gap: 8px;

	&__title { font-weight: 600; font-size: 16px; }
	&__text { font-size: 14px; opacity: .8; }
	&__row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
	&__row > * {
		min-height: 36px;
		padding: 0 14px;
		border-radius: 18px;
		border: 1px solid var(--color-border, #ccc);
		background: transparent;
		color: inherit;
		font: inherit;
		display: inline-flex;
		align-items: center;
		cursor: pointer;
		text-decoration: none;
	}
	&__dl { background: var(--color-primary-element, #0082c9) !important; color: var(--color-primary-element-text, #fff) !important; border-color: transparent !important; }
}
</style>
