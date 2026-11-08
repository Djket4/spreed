<?php

declare(strict_types=1);
/**
 * ket4tec: k4draw. Снимок «экран + пометки» из режима рисования: файл в записи владельца + сообщение в чат.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Controller;

use OCA\Talk\Chat\ChatManager;
use OCA\Talk\Exceptions\ParticipantNotFoundException;
use OCA\Talk\Middleware\Attribute\RequireModeratorOrNoLobby;
use OCA\Talk\Middleware\Attribute\RequireParticipant;
use OCA\Talk\Middleware\Attribute\RequirePermission;
use OCA\Talk\Middleware\Attribute\RequireReadWriteConversation;
use OCA\Talk\Service\ParticipantService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\OpenAPI;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Services\IAppConfig;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\IRootFolder;
use OCP\IRequest;
use OCP\Constants;
use OCP\Share\IManager as ShareManager;
use OCP\Share\IShare;
use Psr\Log\LoggerInterface;

class K4DrawController extends AEnvironmentAwareOCSController {
	private const MAX_BYTES = 8 * 1024 * 1024;
	private const MAX_SIDE = 8192;

	public function __construct(
		string $appName,
		IRequest $request,
		private readonly IAppConfig $appConfig,
		private readonly IRootFolder $rootFolder,
		private readonly ShareManager $shareManager,
		private readonly ChatManager $chatManager,
		private readonly ParticipantService $participantService,
		private readonly ITimeFactory $timeFactory,
		private readonly LoggerInterface $logger,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * Сохранить снимок показа с пометками (multipart, поле `image`).
	 *
	 * @return DataResponse<Http::STATUS_OK, array{file: string, chat: bool}, array{}>|DataResponse<Http::STATUS_BAD_REQUEST|Http::STATUS_INTERNAL_SERVER_ERROR, array{error: string}, array{}>
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

		return new DataResponse(['file' => $path, 'chat' => $this->shareToChat($owner, $file, $author)]);
	}

	private function shareToChat(string $owner, \OCP\Files\File $file, string $author): bool {
		try {
			$ownerParticipant = $this->participantService->getParticipant($this->room, $owner, false);
		} catch (ParticipantNotFoundException) {
			return false;
		}
		try {
			$now = $this->timeFactory->getDateTime();
			$share = $this->shareManager->newShare();
			$share->setNodeId($file->getId())
				->setShareTime($now)
				->setSharedBy($owner)
				->setNode($file)
				->setShareType(IShare::TYPE_ROOM)
				->setSharedWith($this->room->getToken())
				->setPermissions(Constants::PERMISSION_READ);
			$share = $this->shareManager->createShare($share);
			$this->chatManager->addSystemMessage(
				$this->room,
				$ownerParticipant,
				$ownerParticipant->getAttendee()->getActorType(),
				$owner,
				json_encode([
					'message' => 'file_shared',
					'parameters' => [
						'share' => $share->getId(),
						'metaData' => [
							'mimeType' => 'image/png',
							'caption' => 'Снимок с пометками — ' . $author,
						],
					],
				], JSON_THROW_ON_ERROR),
				$now,
				true,
			);
			return true;
		} catch (\Throwable $e) {
			$this->logger->warning('k4draw snapshot share: ' . $e->getMessage(), ['exception' => $e]);
			return false;
		}
	}
}
