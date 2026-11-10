<?php

declare(strict_types=1);
/**
 * ket4tec: k4draw. Снимок «экран + пометки» из режима рисования: файл в записи владельца (Снимки/).
 * В чат не дублируем: снимки уходят в выжимку через autorec (блок 7).
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Controller;

use OCA\Talk\Chat\ChatManager;
use OCA\Talk\Middleware\Attribute\RequireModeratorOrNoLobby;
use OCA\Talk\Middleware\Attribute\RequireParticipant;
use OCA\Talk\Middleware\Attribute\RequirePermission;
use OCA\Talk\Middleware\Attribute\RequireReadWriteConversation;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\OpenAPI;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\FileDisplayResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Services\IAppConfig;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\IPreview;
use OCP\IRequest;
use OCP\Lock\ILockingProvider;
use OCP\Lock\LockedException;
use OCP\Share\IManager as IShareManager;
use Psr\Log\LoggerInterface;

class K4DrawController extends AEnvironmentAwareOCSController {
	private const MAX_BYTES = 8 * 1024 * 1024;
	private const MAX_SIDE = 8192;

	public function __construct(
		string $appName,
		IRequest $request,
		private readonly IAppConfig $appConfig,
		private readonly IRootFolder $rootFolder,
		private readonly ITimeFactory $timeFactory,
		private readonly LoggerInterface $logger,
		private readonly ChatManager $chatManager,
		private readonly IShareManager $shareManager,
		private readonly IPreview $preview,
		private readonly ILockingProvider $lockingProvider,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * Сохранить снимок показа с пометками (multipart, поле `image`).
	 *
	 * @return DataResponse<Http::STATUS_OK, array{file: string, id: int}, array{}>|DataResponse<Http::STATUS_BAD_REQUEST|Http::STATUS_INTERNAL_SERVER_ERROR, array{error: string}, array{}>
	 */
	#[OpenAPI(scope: OpenAPI::SCOPE_IGNORE)]
	#[PublicPage]
	#[RequireModeratorOrNoLobby]
	#[RequireParticipant]
	#[RequirePermission(permission: RequirePermission::CHAT)]
	#[RequireReadWriteConversation]
	#[UserRateLimit(limit: 20, period: 600)]
	#[AnonRateLimit(limit: 20, period: 600)]
	#[ApiRoute(verb: 'POST', url: '/api/{apiVersion}/k4draw/{token}/snapshot', requirements: [
		'apiVersion' => '(v1)',
		'token' => '[a-z0-9]{4,30}',
	])]
	public function snapshot(): DataResponse {
		if ($this->room->getActiveSince() === null) {
			return new DataResponse(['error' => 'call'], Http::STATUS_BAD_REQUEST);
		}

		$up = $this->request->getUploadedFile('image');
		if (!is_array($up) || ($up['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
			|| !is_uploaded_file($up['tmp_name']) || $up['size'] > self::MAX_BYTES || $up['size'] < 67) {
			return new DataResponse(['error' => 'image'], Http::STATUS_BAD_REQUEST);
		}
		$data = file_get_contents($up['tmp_name']);
		if ($data === false || strlen($data) > self::MAX_BYTES || !str_starts_with($data, "\x89PNG\r\n\x1a\n")) {
			return new DataResponse(['error' => 'image'], Http::STATUS_BAD_REQUEST);
		}
		$info = @getimagesizefromstring($data);
		if ($info === false || $info[2] !== IMAGETYPE_PNG || $info[0] < 1 || $info[1] < 1
			|| $info[0] > self::MAX_SIDE || $info[1] > self::MAX_SIDE) {
			return new DataResponse(['error' => 'image'], Http::STATUS_BAD_REQUEST);
		}

		$author = trim($this->participant->getAttendee()->getDisplayName());
		$author = $author !== '' ? $author : 'Гость';
		// в имени файла нельзя разделители пути и служебные символы
		$safe = trim(preg_replace('/[\\\\\/:*?"<>|\x00-\x1f]+/u', ' ', mb_substr($author, 0, 60)));
		$safe = $safe !== '' ? $safe : 'Гость';

		$owner = $this->appConfig->getAppValueString('k4draw_snapshot_owner', 'andrey');
		try {
			$folder = $this->rootFolder->getUserFolder($owner);
			foreach (['Talk', 'Recording', $this->room->getToken(), 'Снимки'] as $dir) {
				$folder = $folder->nodeExists($dir) ? $folder->get($dir) : $folder->newFolder($dir);
			}
			$now = $this->timeFactory->getDateTime('now', new \DateTimeZone('Europe/Moscow'));
			$name = $folder->getNonExistingName($now->format('Y-m-d H-i-s') . ' — ' . $safe . '.png');
			$file = $folder->newFile($name, $data);
		} catch (\Throwable $e) {
			$this->logger->error('k4draw snapshot: ' . $e->getMessage(), ['exception' => $e]);
			return new DataResponse(['error' => 'store'], Http::STATUS_INTERNAL_SERVER_ERROR);
		}
		$path = 'Talk/Recording/' . $this->room->getToken() . '/Снимки/' . $name;

		return new DataResponse(['file' => $path, 'id' => $file->getId()]);
	}

	/**
	 * Папка снимков комнаты у владельца записи (null — снимков ещё не было).
	 */
	private function snapFolder(): ?Folder {
		$folder = $this->rootFolder->getUserFolder($this->appConfig->getAppValueString('k4draw_snapshot_owner', 'andrey'));
		foreach (['Talk', 'Recording', $this->room->getToken(), 'Снимки'] as $dir) {
			if (!$folder->nodeExists($dir)) {
				return null;
			}
			$folder = $folder->get($dir);
			if (!$folder instanceof Folder) {
				return null;
			}
		}
		return $folder;
	}

	/**
	 * Картинка для доски и превью панели: превью нужного размера, PNG-снимок без превью — как есть.
	 */
	private function image(File $file, int $size): Response {
		$size = max(64, min(2048, $size));
		try {
			$img = $this->preview->getPreview($file, $size, $size, false);
			$res = new FileDisplayResponse($img, Http::STATUS_OK, ['Content-Type' => $img->getMimeType()]);
		} catch (\Throwable) {
			if (!in_array($file->getMimeType(), ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], true)) {
				return new DataResponse([], Http::STATUS_NOT_FOUND);
			}
			$res = new FileDisplayResponse($file, Http::STATUS_OK, ['Content-Type' => $file->getMimeType()]);
		}
		$res->cacheFor(3600, false, true);
		return $res;
	}

	/**
	 * Снимки доски этого звонка (новые первыми) для панели «Файлы».
	 *
	 * @return DataResponse<Http::STATUS_OK, list<array{id: int, name: string, mtime: int}>, array{}>
	 */
	#[OpenAPI(scope: OpenAPI::SCOPE_IGNORE)]
	#[PublicPage]
	#[RequireModeratorOrNoLobby]
	#[RequireParticipant]
	#[ApiRoute(verb: 'GET', url: '/api/{apiVersion}/k4draw/{token}/snapshots', requirements: [
		'apiVersion' => '(v1)',
		'token' => '[a-z0-9]{4,30}',
	])]
	public function snapshots(): DataResponse {
		// гость без чата снимки прошлых звонков не листает — только выведенные на доску
		if ($this->participant->cannotSeeChat()) {
			return new DataResponse([]);
		}
		$out = [];
		try {
			foreach ($this->snapFolder()?->getDirectoryListing() ?? [] as $n) {
				if ($n instanceof File && $n->getMimeType() === 'image/png') {
					$out[] = ['id' => $n->getId(), 'name' => $n->getName(), 'mtime' => $n->getMTime()];
				}
			}
		} catch (\Throwable $e) {
			$this->logger->warning('k4draw snapshots: ' . $e->getMessage());
		}
		usort($out, static fn ($a, $b) => $b['mtime'] <=> $a['mtime'] ?: $b['id'] <=> $a['id']);
		return new DataResponse(array_slice($out, 0, 60));
	}

	/**
	 * Снимок доски этого звонка картинкой (фон доски, превью в панели). Гость — по сессии участника.
	 */
	#[OpenAPI(scope: OpenAPI::SCOPE_IGNORE)]
	#[PublicPage]
	#[NoCSRFRequired]
	#[RequireModeratorOrNoLobby]
	#[RequireParticipant]
	#[ApiRoute(verb: 'GET', url: '/api/{apiVersion}/k4draw/{token}/snapshot/{id}', requirements: [
		'apiVersion' => '(v1)',
		'token' => '[a-z0-9]{4,30}',
		'id' => '\d{1,18}',
	])]
	public function snapshotImage(int $id, int $size = 1600): Response {
		if ($this->participant->cannotSeeChat() && !in_array('s' . $id, $this->shown(), true)) {
			return new DataResponse([], Http::STATUS_NOT_FOUND);
		}
		try {
			$file = $this->snapFolder()?->getFirstNodeById($id);
		} catch (\Throwable) {
			$file = null;
		}
		return $file instanceof File ? $this->image($file, $size) : new DataResponse([], Http::STATUS_NOT_FOUND);
	}

	/**
	 * Картинка из сообщения беседы с файлом (системное `file_shared` этой комнаты), иначе null.
	 */
	private function chatFile(int $messageId): ?File {
		try {
			$c = $this->chatManager->getComment($this->room, (string)$messageId);
			// обычное сообщение пользователя (verb comment) с подделанным JSON не годится
			if ($c->getVerb() !== ChatManager::VERB_OBJECT_SHARED) {
				return null;
			}
			$m = json_decode($c->getMessage(), true);
			if (($m['message'] ?? '') !== 'file_shared' || !isset($m['parameters']['share'])) {
				return null;
			}
			$share = $this->shareManager->getShareById('ocRoomShare:' . $m['parameters']['share']);
			if ($share->getSharedWith() !== $this->room->getToken()) {
				return null;
			}
			$node = $share->getNode();
		} catch (\Throwable) {
			return null;
		}
		return $node instanceof File && str_starts_with($node->getMimeType(), 'image/') ? $node : null;
	}

	/** Выведенное на доску в этой комнате ('m<id>' — картинка беседы, 's<id>' — снимок); гость без чата видит только это. */
	private function shown(): array {
		$list = json_decode($this->appConfig->getAppValueString('k4draw_shown_' . $this->room->getToken(), '[]'), true) ?: [];
		// старый формат: число = id сообщения беседы
		return array_map(static fn ($v) => is_int($v) ? 'm' . $v : (string)$v, $list);
	}

	/** Добавить отметку в список «выведенного» под эксклюзивной блокировкой (чтение-запись неатомарны). */
	private function markShown(string $key): bool {
		$lock = 'spreed/k4draw/shown/' . $this->room->getToken();
		for ($i = 0;; $i++) {
			try {
				$this->lockingProvider->acquireLock($lock, ILockingProvider::LOCK_EXCLUSIVE);
				break;
			} catch (LockedException) {
				if ($i >= 50) {
					return false;
				}
				usleep(100000);
			}
		}
		try {
			// ponytail: список на комнату в app config (последние 20), без чистки; в таблицу — если комнат с показами станут тысячи
			// кеш AppConfig загружен до блокировки — перечитываем, иначе параллельный показ затрёт чужую отметку
			\OCP\Server::get(\OCP\IAppConfig::class)->clearCache(true);
			$ids = array_values(array_unique([$key, ...$this->shown()]));
			$this->appConfig->setAppValueString('k4draw_shown_' . $this->room->getToken(), json_encode(array_slice($ids, 0, 20)));
		} finally {
			$this->lockingProvider->releaseLock($lock, ILockingProvider::LOCK_EXCLUSIVE);
		}
		return true;
	}

	/**
	 * «Показать всем» картинку из беседы: отметить, что её можно отдать участникам без чата (гостям) как фон доски.
	 *
	 * @return DataResponse<Http::STATUS_OK|Http::STATUS_NOT_FOUND|Http::STATUS_INTERNAL_SERVER_ERROR, array{}, array{}>
	 */
	#[OpenAPI(scope: OpenAPI::SCOPE_IGNORE)]
	#[PublicPage]
	#[RequireModeratorOrNoLobby]
	#[RequireParticipant]
	#[RequireReadWriteConversation]
	#[UserRateLimit(limit: 60, period: 600)]
	#[ApiRoute(verb: 'POST', url: '/api/{apiVersion}/k4draw/{token}/image/{messageId}', requirements: [
		'apiVersion' => '(v1)',
		'token' => '[a-z0-9]{4,30}',
		'messageId' => '\d{1,18}',
	])]
	public function showChatImage(int $messageId): DataResponse {
		if ($this->participant->cannotSeeChat() || $this->chatFile($messageId) === null) {
			return new DataResponse([], Http::STATUS_NOT_FOUND);
		}
		return $this->markShown('m' . $messageId) ? new DataResponse([]) : new DataResponse([], Http::STATUS_INTERNAL_SERVER_ERROR);
	}

	/**
	 * «Показать всем» снимок доски: отметить, что его можно отдать гостям как фон доски.
	 *
	 * @return DataResponse<Http::STATUS_OK|Http::STATUS_NOT_FOUND|Http::STATUS_INTERNAL_SERVER_ERROR, array{}, array{}>
	 */
	#[OpenAPI(scope: OpenAPI::SCOPE_IGNORE)]
	#[PublicPage]
	#[RequireModeratorOrNoLobby]
	#[RequireParticipant]
	#[RequireReadWriteConversation]
	#[UserRateLimit(limit: 60, period: 600)]
	#[ApiRoute(verb: 'POST', url: '/api/{apiVersion}/k4draw/{token}/snapshot/{id}', requirements: [
		'apiVersion' => '(v1)',
		'token' => '[a-z0-9]{4,30}',
		'id' => '\d{1,18}',
	])]
	public function showSnapshot(int $id): DataResponse {
		if ($this->participant->cannotSeeChat()) {
			return new DataResponse([], Http::STATUS_NOT_FOUND);
		}
		try {
			$file = $this->snapFolder()?->getFirstNodeById($id);
		} catch (\Throwable) {
			$file = null;
		}
		if (!$file instanceof File) {
			return new DataResponse([], Http::STATUS_NOT_FOUND);
		}
		return $this->markShown('s' . $id) ? new DataResponse([]) : new DataResponse([], Http::STATUS_INTERNAL_SERVER_ERROR);
	}

	/**
	 * Картинка из сообщения беседы — фон доски «Показать всем» и превью в панели.
	 * Участник с чатом — любая картинка беседы; гость без чата (#55) — только выведенная на доску.
	 */
	#[OpenAPI(scope: OpenAPI::SCOPE_IGNORE)]
	#[PublicPage]
	#[NoCSRFRequired]
	#[RequireModeratorOrNoLobby]
	#[RequireParticipant]
	#[ApiRoute(verb: 'GET', url: '/api/{apiVersion}/k4draw/{token}/image/{messageId}', requirements: [
		'apiVersion' => '(v1)',
		'token' => '[a-z0-9]{4,30}',
		'messageId' => '\d{1,18}',
	])]
	public function chatImage(int $messageId, int $size = 1600): Response {
		$file = (!$this->participant->cannotSeeChat() || in_array('m' . $messageId, $this->shown(), true)) ? $this->chatFile($messageId) : null;
		return $file ? $this->image($file, $size) : new DataResponse([], Http::STATUS_NOT_FOUND);
	}
}
