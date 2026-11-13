/**
 * SPDX-FileCopyrightText: 2020 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Conversation } from '../types/index.ts'

import { defineStore } from 'pinia'
import BrowserStorage from '../services/BrowserStorage.js'
import {
	disableLiveTranscription,
	enableLiveTranscription,
	setLiveTranscriptionTargetLanguage,
} from '../services/liveTranscriptionService.ts'

type State = {
	forceCallView: boolean
	isViewerOverlay: boolean
	isGrid: boolean
	isMultiSpeaker: boolean
	isStripeOpen: boolean
	isEmptyCallView: boolean
	lastIsGrid: boolean | null
	lastIsStripeOpen: boolean | null
	presentationStarted: boolean
	selectedVideoPeerId: string | null
	gridBeforePin: boolean
	gridBeforePresentation: boolean | null
	callEndedTimeout: ReturnType<typeof setTimeout> | undefined
	isLiveTranscriptionEnabled: boolean
	externalCallServiceUrl: string | null
	/** ket4tec (NAS_CLOUD#195 п.2): чей экран крупно — в шапке звонка «Показывает: …» */
	k4PresenterName: string
}

type CallViewModePayload = {
	token: string
	isGrid?: boolean | null
	isMultiSpeaker?: boolean | null
	isStripeOpen?: boolean | null
	clearLast?: boolean
	/** ручной выбор вида человеком: возврат вида после показа экрана отменяется */
	manual?: boolean
}

/**
 * ket4tec (NAS_CLOUD#108): полоса камер при показе открыта принудительно, но на низком окне
 * (телефон в альбоме, 844×390) её 150 px съедают показ — там штатно закрыта.
 */
export const LOW_SCREEN = '(max-height: 500px)'
export function stripeOpenForced(): boolean {
	return !window.matchMedia?.(LOW_SCREEN).matches
}

export const useCallViewStore = defineStore('callView', {
	state: (): State => ({
		forceCallView: false,
		isViewerOverlay: false,
		isGrid: false,
		isMultiSpeaker: false,
		isStripeOpen: true,
		isEmptyCallView: true,
		lastIsGrid: null,
		lastIsStripeOpen: null,
		presentationStarted: false,
		selectedVideoPeerId: null,
		gridBeforePin: false,
		gridBeforePresentation: null,
		callEndedTimeout: undefined,
		isLiveTranscriptionEnabled: false,
		externalCallServiceUrl: null,
		k4PresenterName: '',
	}),

	getters: {
		callHasJustEnded: (state) => !!state.callEndedTimeout,
	},

	actions: {
		setForceCallView(value: boolean) {
			this.forceCallView = value
		},

		setExternalCallServiceUrl(url: string | null) {
			this.externalCallServiceUrl = url
		},

		leaveExternalCall() {
			this.setExternalCallServiceUrl(null)
			this.setForceCallView(false)
		},

		setIsViewerOverlay(value: boolean) {
			this.isViewerOverlay = value
		},

		setIsEmptyCallView(value: boolean) {
			this.isEmptyCallView = value
		},

		setSelectedVideoPeerId(value: string | null) {
			// ket4tec (NAS_CLOUD#153): запоминаем вид до закрепления, чтобы «Открепить» вернул его
			if (value !== null && this.selectedVideoPeerId === null) {
				this.gridBeforePin = this.isGrid
			}
			this.selectedVideoPeerId = value
		},

		/**
		 * ket4tec (NAS_CLOUD#153): снять закрепление; без идущего показа экрана — закончить показ
		 * и вернуть вид, который был до закрепления. С экраном остаёмся в виде докладчика.
		 *
		 * @param token current conversation token;
		 * @param hasScreens идёт показ экрана (свой или чужой).
		 */
		unpinVideo(token: string, hasScreens = false) {
			this.selectedVideoPeerId = null
			if (hasScreens) {
				return
			}
			this.stopPresentation(token)
			if (this.gridBeforePin) {
				this.setCallViewMode({ token, isGrid: true, clearLast: false })
			}
		},

		handleJoinCall(conversation: Conversation) {
			if (!conversation) {
				return
			}
			// Start every call with a clean selection, so a stale peer id
			// from a previous call is not carried over
			this.setSelectedVideoPeerId(null)
			// ket4tec: каждый звонок начинается с сетки (все крупными плитками, своя тоже), и вдвоём тоже.
			// Сохранённое «докладчик» не берём: его пишет и автоматика показа экрана. Переключатель вида остаётся.
			const isGrid = true
			// ket4tec (NAS_CLOUD#153): режима «несколько говорящих» нет, сохранённую настройку не читаем
			this.setCallViewMode({ token: conversation.token, isGrid, isMultiSpeaker: false, isStripeOpen: true })
		},

		/**
		 * Sets the current call view mode and saves it in preferences.
		 * If clearLast is false, also remembers it in separate properties.
		 *
		 * @param data the wrapping object;
		 * @param data.token current conversation token;
		 * @param data.isGrid true for enabled grid mode, false for speaker view;
		 * @param data.isMultiSpeaker true to promote several speakers at once in speaker view;
		 * @param data.isStripeOpen true for visible striped mode, false for speaker view;
		 * @param data.clearLast set false to not reset last temporary remembered state;
		 * @param data.manual true when the person picked the view by hand;
		 */
		setCallViewMode({ token, isGrid = null, isMultiSpeaker = null, isStripeOpen = null, clearLast = true, manual = false }: CallViewModePayload) {
			// ket4tec (NAS_CLOUD#159): человек сам выбрал вид во время показа - по окончании не возвращаем старый
			if (manual) {
				this.gridBeforePresentation = null
			}
			if (clearLast) {
				this.lastIsGrid = null
				this.lastIsStripeOpen = null
			}

			if (isGrid !== null && isGrid !== undefined) {
				this.lastIsGrid = this.isGrid
				BrowserStorage.setItem(`callprefs-${token}-isgrid`, isGrid.toString())
				this.isGrid = isGrid

				if (isGrid) {
					this.setSelectedVideoPeerId(null)
				}
			}

			if (isMultiSpeaker !== null && isMultiSpeaker !== undefined) {
				BrowserStorage.setItem(`callprefs-${token}-multispeaker`, isMultiSpeaker.toString())
				this.isMultiSpeaker = isMultiSpeaker
			}

			if (isStripeOpen !== null && isStripeOpen !== undefined) {
				this.lastIsStripeOpen = this.isStripeOpen
				this.isStripeOpen = isStripeOpen
			}
		},

		/**
		 * Starts presentation mode.
		 *
		 * Switches off grid mode and closes the stripe.
		 * Remembers the call view state for after the end of the presentation.
		 *
		 * @param token current conversation token.
		 */
		startPresentation(token: string) {
			// don't start twice, this would prevent multiple screen shares to clear the last call view state
			if (this.presentationStarted) {
				return
			}
			this.presentationStarted = true
			// ket4tec (NAS_CLOUD#159): вид до показа (при закреплении - вид до закрепления)
			this.gridBeforePresentation = this.selectedVideoPeerId !== null ? this.gridBeforePin : this.isGrid

			this.setCallViewMode({ token, isGrid: false, isStripeOpen: stripeOpenForced(), clearLast: false }) // ket4tec (NAS_CLOUD#108 п.1): полоса не закрывается — своя камера видна; на низком окне закрыта
		},

		/**
		 * Stops presentation mode.
		 *
		 * Restores call view state from before starting the presentation,
		 * given that the last state was not cleared manually.
		 *
		 * @param token current conversation token.
		 */
		stopPresentation(token: string) {
			if (!this.presentationStarted) {
				return
			}
			this.presentationStarted = false

			// ket4tec (NAS_CLOUD#159): показ кончился - вернуть вид, который был до него (закрепление из #153 не трогаем)
			if (!this.isGrid && this.selectedVideoPeerId === null && this.gridBeforePresentation !== null) {
				this.setCallViewMode({ token, isGrid: this.gridBeforePresentation, clearLast: false })
			}
			this.gridBeforePresentation = null
		},

		/**
		 * Checks the time difference between the current time and the call end time.
		 * Then, disable the CallButton for the remaining time until 10 seconds after the call ends.
		 *
		 * @param timestamp timestamp of callEnded message (in seconds)
		 */
		setCallHasJustEnded(timestamp: number) {
			const timeDiff = Math.abs(Date.now() - timestamp * 1000)
			if (10000 - timeDiff < 0) {
				return
			}
			clearTimeout(this.callEndedTimeout)
			this.callEndedTimeout = setTimeout(() => {
				this.resetCallHasJustEnded()
			}, Math.max(0, 10000 - timeDiff))
		},

		resetCallHasJustEnded() {
			clearTimeout(this.callEndedTimeout)
			this.callEndedTimeout = undefined
		},

		/**
		 * @param token
		 * @throws error if live transcription could not be enabled.
		 */
		async enableLiveTranscription(token: string) {
			try {
				await enableLiveTranscription(token)

				this.isLiveTranscriptionEnabled = true
			} catch (error) {
				console.error(error)

				throw error
			}
		},

		/**
		 * @param token
		 * @param targetLanguageId
		 * @throws error if live translation target language could not be set.
		 */
		async setLiveTranscriptionTargetLanguage(token: string, targetLanguageId: string | null) {
			try {
				await setLiveTranscriptionTargetLanguage(token, targetLanguageId)
			} catch (error) {
				console.error(error)

				throw error
			}
		},

		/**
		 * @param token
		 * @throws error if live transcription could not be enabled.
		 */
		async disableLiveTranscription(token: string) {
			try {
				// Locally disable transcriptions even if they could not be
				// disabled in the server.
				this.isLiveTranscriptionEnabled = false

				await disableLiveTranscription(token)
			} catch (error) {
				console.error(error)

				throw error
			}
		},
	},
})
