/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { reactive } from 'vue'

// NAS_CLOUD#172, этап 2: peerId -> имя участника, чей кадр пришёл как 2:1 (два квадрата). Плитку такого участника
// сетка показывает двумя квадратами; заполняет VideoVue, читают VideosGrid и вторая половина (K4SplitTile).
export const splitPeers = reactive(new Map())
