import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { k4plainAvatar } from './AvatarWrapper.vue'

beforeEach(() => {
	vi.useFakeTimers()
	global.fetch = vi.fn(() => Promise.resolve({ headers: { get: () => '0' } }))
})
afterEach(() => vi.useRealTimers())

test('Б5: ответ о картинке перепроверяется после TTL, не живёт до перезагрузки', async () => {
	expect(k4plainAvatar('u1')).toBe(false) // первый вызов: ещё не знаем
	await vi.advanceTimersByTimeAsync(0)
	expect(k4plainAvatar('u1')).toBe(true) // знаем: своей картинки нет
	expect(fetch).toHaveBeenCalledTimes(1) // в пределах TTL без нового запроса
	global.fetch = vi.fn(() => Promise.resolve({ headers: { get: () => null } })) // пользователь загрузил картинку
	vi.advanceTimersByTime(5 * 60 * 1000 + 1)
	k4plainAvatar('u1')
	await vi.advanceTimersByTimeAsync(0)
	expect(fetch).toHaveBeenCalledTimes(1)
	expect(k4plainAvatar('u1')).toBe(false)
})
