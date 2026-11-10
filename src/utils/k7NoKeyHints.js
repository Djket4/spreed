/**
 * ket4tec: на сенсорном экране клавиатурных сокращений нет — подсказки «(F)», «(R)», «(M)» в подписях не нужны.
 * Подмена до импорта компонентов: часть из них читает флаг при загрузке модуля.
 */
if (window.matchMedia?.('(pointer: coarse)').matches && window.OCP?.Accessibility) {
	window.OCP.Accessibility.disableKeyboardShortcuts = () => true
}
