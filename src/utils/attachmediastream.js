/**
 * SPDX-FileCopyrightText: 2019 "Henrik Joreteg <henrik@andyet.net>
 * SPDX-License-Identifier: MIT
 *
 * Copy of https://github.com/otalk/attachMediaStream/blob/master/attachmediastream.js
 * Modifications:
 * - Adjusted for eslint rules
 * - Migrated to ESM
 * - Added JSDoc
 */

import adapter from 'webrtc-adapter'

/**
 * Attach a media stream to a video (or audio) element.
 * It handles the differences between browsers.
 *
 * @param {MediaStream} stream The media stream to attach
 * @param {HTMLVideoElement|null} el The video element where to attach the stream.
 *                                   If null, a new element will be created.
 * @param {object} [options] Options
 * @param {boolean} [options.autoplay] Autoplay the video
 * @param {boolean} [options.mirror] Mirror the video (horizontal flip)
 * @param {boolean} [options.muted] Mute the audio
 * @param {boolean} [options.audio] Only use audio
 * @param {boolean} [options.disableContextMenu] Disable the context menu
 */
export default function attachmediastream(stream, el, options) {
	let item
	let element = el
	const opts = {
		autoplay: true,
		mirror: false,
		muted: false,
		audio: false,
		disableContextMenu: false,
	}

	if (options) {
		for (item in options) {
			opts[item] = options[item]
		}
	}

	if (!element) {
		element = document.createElement(opts.audio ? 'audio' : 'video')
	} else if (element.tagName.toLowerCase() === 'audio') {
		opts.audio = true
	}

	if (opts.disableContextMenu) {
		element.oncontextmenu = function(e) {
			e.preventDefault()
		}
	}

	if (opts.autoplay) {
		element.autoplay = 'autoplay'
	}
	// ket4tec: у <video> звук всегда выключен (его играет отдельный <audio>) и выключен ДО srcObject —
	// иначе автозапуск считается «со звуком», браузер его блокирует и плитка остаётся чёрной на паузе
	// (так было с плитками, которые создаются после остановки показа экрана)
	element.muted = opts.audio ? !!opts.muted : true
	if (!opts.audio) {
		['', 'moz', 'webkit', 'o', 'ms'].forEach(function(prefix) {
			const styleName = prefix ? prefix + 'Transform' : 'transform'
			element.style[styleName] = opts.mirror ? 'scaleX(-1)' : 'scaleX(1)'
		})
	}

	if (adapter.browserDetails.browser === 'safari') {
		element.setAttribute('playsinline', true)
	}

	element.srcObject = stream
	if (opts.autoplay && stream) {
		element.play?.()?.catch(() => {}) // ket4tec: autoplay-атрибута мало, если элемент создан без жеста пользователя
	}
	return element
}
