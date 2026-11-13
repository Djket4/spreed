<!--
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -
  - ket4tec: k4draw. Плашка «Приложение не найдено»: схема k4draw:// не сработала.
-->

<template>
	<Teleport to="body">
		<div
			v-if="mac.st === 'allow'"
			class="k4-missing"
			role="alertdialog"
			aria-label="Нужно разрешение браузера">
			<div class="k4-missing__title">
				Нужно разрешение браузера
			</div>
			<div class="k4-missing__text">
				Разрешите доступ в запросе браузера (вверху слева). Без него связь с приложением не установится.
			</div>
			<div class="k4-missing__row">
				<button type="button" @click="closeMissing()">
					Закрыть
				</button>
			</div>
		</div>
		<div
			v-if="mac.st === 'denied'"
			class="k4-missing"
			role="alertdialog"
			aria-label="Доступ запрещён в браузере">
			<div class="k4-missing__title">
				Доступ запрещён в браузере
			</div>
			<div class="k4-missing__text">
				Нажмите значок слева от адреса, разрешите «Доступ к другим приложениям и службам на этом устройстве» и нажмите «Рисовать на экране» ещё раз.
			</div>
			<div class="k4-missing__row">
				<button type="button" @click="connectAnyway()">
					Уже установлено
				</button>
				<button type="button" @click="closeMissing()">
					Закрыть
				</button>
			</div>
		</div>
		<div
			v-if="mac.st === 'blocked'"
			class="k4-missing"
			role="alertdialog"
			aria-label="Подключить приложение">
			<div class="k4-missing__title">
				Браузер не открыл окно связи
			</div>
			<div class="k4-missing__text">
				Нажмите кнопку, чтобы подключить приложение «Рисовать на экране».
			</div>
			<div class="k4-missing__row">
				<button type="button" @click="connectAnyway()">
					Подключить приложение
				</button>
				<button type="button" @click="closeMissing()">
					Закрыть
				</button>
			</div>
		</div>
		<div
			v-if="mac.st === 'unverified'"
			class="k4-missing"
			role="alertdialog"
			aria-label="Не удалось проверить приложение">
			<div class="k4-missing__title">
				Не удалось проверить приложение
			</div>
			<div class="k4-missing__text">
				Браузер не даёт проверить, запущено ли оно. Если приложение установлено, подключите его вручную.
			</div>
			<div class="k4-missing__row">
				<button type="button" @click="connectAnyway()">
					Подключить вручную
				</button>
				<a
					class="k4-missing__dl k4-missing__dl--minor"
					:href="MAC_DL"
					target="_blank"
					rel="noopener">Скачать</a>
				<button type="button" @click="closeMissing()">
					Закрыть
				</button>
			</div>
		</div>
		<div
			v-if="mac.st === 'noapp'"
			class="k4-missing"
			role="alertdialog"
			aria-label="Приложение не найдено">
			<div class="k4-missing__title">
				Приложение не найдено
			</div>
			<div class="k4-missing__text">
				Скачайте его и один раз откройте вручную. После этого кнопка «Рисовать на экране» будет запускать его сама.
			</div>
			<div class="k4-missing__row">
				<a
					class="k4-missing__dl"
					:href="MAC_DL"
					target="_blank"
					rel="noopener">Скачать</a>
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
import { closeMissing, connectAnyway, mac, MAC_DL } from './macBridge.js'
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
	&__dl--minor { background: transparent !important; color: var(--color-text-maxcontrast, #707070) !important; text-decoration: underline; }
}
</style>
