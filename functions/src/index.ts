import {
    ClientConfig,
    TemplateMessage,
    messagingApi,
    webhook,
    TemplateColumn,
    TextMessage,
    Message,
} from '@line/bot-sdk';
import dayjs from 'dayjs';
import ja from 'dayjs/locale/ja';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import * as admin from 'firebase-admin';
import {
    CollectionReference,
    DocumentSnapshot,
    QuerySnapshot,
    Timestamp,
    getFirestore,
} from 'firebase-admin/firestore';
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import { getAnotherFirestore } from './replica/anotherStore';
import ScheduleDoc from './types/schedule';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale(ja);

const STATIC_TIMEZONE = 'Asia/Tokyo';

const lineConfig: ClientConfig = {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
};

const noticeLineConfig: ClientConfig = {
    channelSecret: process.env.LINE_NOTICE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_NOTICE_CHANNEL_ACCESS_TOKEN || '',
};

const siteBaseUrl = process.env.SITE_BASE_URL || 'http://localhost:3000';

const client = new messagingApi.MessagingApiClient(lineConfig);
const noticeLineClient = new messagingApi.MessagingApiClient(noticeLineConfig);

const firebaseAdmin = admin.initializeApp();
const firestoreAdmin = getFirestore(firebaseAdmin);

/**
 * 会計処理のAPI
 */
exports.accounting = require('./accounting');

/**
 * Hello WorldのAPI
 *
 * @deprecated ただのテスト用
 */
export const helloWorld = functions
    .region('asia-northeast1')
    .https.onRequest((request, response) => {
        logger.info('Hello logs!', { structuredData: true });
        response.send(`Hello ${process.env.TEST} from Firebase!!!!!!`);
    });

/**
 * LINEのWebhook用のAPI
 */
export const lineWebhook = functions
    .region('asia-northeast1')
    .https.onRequest(async (request, response) => {
        logger.info('LINE webhook called');

        const callbackRequest: webhook.CallbackRequest = request.body;
        const events: webhook.Event[] = callbackRequest.events ?? [];

        logger.info(
            'LINE webhook abalable events callbackRequest',
            callbackRequest,
            callbackRequest,
        );

        for (const event of events) {
            switch (event.type) {
                case 'message': {
                    if (event.source?.type !== 'user') {
                        logger.info('LINE webhook not user message', event);
                        break;
                    }
                    await client.replyMessage({
                        replyToken: event.replyToken as string,
                        messages: [
                            {
                                type: 'text',
                                text: '一天運営アカウントはまだ何もできません。メンバーとの会話は引き続き一天グループLINEでお願いします。',
                            },
                        ],
                    });
                    break;
                }
                default: {
                    logger.info('LINE webhook unknown event', event, event);
                }
            }
        }
        logger.info('LINE webhook done');
        response.send('OK');
    });

type LinePushRequest = {
    toId: string;
};

/**
 * 任意のLINEユーザーまたはグループにメッセージを送信するAPI
 *
 * Request: @see LinePushRequest
 */
export const linePush = functions
    .region('asia-northeast1')
    .https.onRequest(async (request, response) => {
        logger.info('LINE push called');

        const LinePushRequest: LinePushRequest = request.body;

        await noticeLineClient.pushMessage({
            to: LinePushRequest.toId,
            messages: [
                {
                    type: 'text',
                    text: '送信テスト',
                },
            ],
        });

        logger.info('LINE push done');
        response.send('OK');
    });

/**
 * 任意のLINEユーザーまたはグループにメッセージを送信するAPI
 *
 * RequestData: @see LinePushRequest
 */
export const linePushOnCall = functions
    .region('asia-northeast1')
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('permission-denied', 'Auth Error');
        }
        logger.info('LINE push called', data, context);

        const LinePushRequest: LinePushRequest = data;

        await client.pushMessage({
            to: LinePushRequest.toId,
            messages: [
                {
                    type: 'text',
                    text: '送信テスト',
                },
            ],
        });

        logger.info('LINE push done');
        return {
            result: 'OK',
        };
    });

type LineSendScheduleMessageRequest = {
    toId?: string;
    scheduleId: string;
};

/**
 * スケジュール追加時にグループLINEで通知するAPI
 *
 * 【toGroup】
 */
export const lineSendAddScheduleMessage = functions
    .region('asia-northeast1')
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('permission-denied', 'Auth Error');
        }
        const linePushRequest: LineSendScheduleMessageRequest = data;
        return await lineSendScheduleMessageCore(linePushRequest, '追加');
    });

/**
 * スケジュール変更時にグループLINEで通知するAPI
 *
 * 【toGroup】
 */
export const lineSendChangeScheduleMessage = functions
    .region('asia-northeast1')
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('permission-denied', 'Auth Error');
        }
        const linePushRequest: LineSendScheduleMessageRequest = data;
        return await lineSendScheduleMessageCore(linePushRequest, '変更');
    });

const lineSendScheduleMessageCore = async (
    lineSendScheduleMessageRequest: LineSendScheduleMessageRequest,
    label: '追加' | '変更',
) => {
    const targetId = lineSendScheduleMessageRequest.toId ?? process.env.LINE_GROUP_ID;
    if (!targetId || !lineSendScheduleMessageRequest.scheduleId) {
        logger.error('必要なパラメータが足りません', lineSendScheduleMessageRequest);
        throw new functions.https.HttpsError('invalid-argument', '必要なパラメータが足りません', {
            key: 'data',
            value: lineSendScheduleMessageRequest,
        });
    }

    const scheduleSnapshot = (await firestoreAdmin
        .collection('schedules')
        .doc(lineSendScheduleMessageRequest.scheduleId)
        .get()) as DocumentSnapshot<ScheduleDoc>;

    const schedule = scheduleSnapshot.data();

    if (!scheduleSnapshot.exists || !schedule) {
        logger.error(
            `指定されたスケジュール${lineSendScheduleMessageRequest.scheduleId}は存在しません`,
        );
        throw new functions.https.HttpsError(
            'invalid-argument',
            `指定されたスケジュール${lineSendScheduleMessageRequest.scheduleId}は存在しません`,
            {
                key: 'scheduleId',
                value: lineSendScheduleMessageRequest.scheduleId,
            },
        );
    }

    logger.info(`LINEで予定${label}のメッセージを送信します`, schedule);

    const startTsDayjs = dayjs(getSaftyDate(schedule.startTimestamp)).tz(STATIC_TIMEZONE);
    const endTsDayjs = dayjs(getSaftyDate(schedule.endTimestamp)).tz(STATIC_TIMEZONE);

    const scheduleMessage: TemplateMessage = {
        type: 'template',
        altText: `予定が${label}されました（[${startTsDayjs.format(
            'M/D(dd)',
        )}]${schedule?.title}）`,
        template: {
            type: 'buttons',
            title: truncateString(`予定${label}「${schedule.title}」`, 40),
            text: truncateString(
                `${schedule.placeName}[${startTsDayjs.format('M/D(dd)H:mm')}-${endTsDayjs.format(
                    'H:mm',
                )}]`,
                60,
            ),
            actions: [
                {
                    type: 'uri',
                    label: '詳細を見る',
                    uri: `${siteBaseUrl}/member/schedule/${lineSendScheduleMessageRequest.scheduleId}`,
                },
            ],
        },
    };

    const message = await noticeLineClient.pushMessage({
        to: targetId,
        messages: [scheduleMessage],
    });

    logger.info(`通知用LINEで予定${label}メッセージを送信しました`, message);
    return {
        result: 'OK',
    };
};

type LineSendAnnounceInputScheduleRequest = {
    toId?: string;
};

/**
 * 出欠回答期限内のスケジュールについてグループLINEで通知するAPI
 *
 * 【toGroup】
 */
export const lineSendAnnounceInputSchedule = functions
    .region('asia-northeast1')
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('permission-denied', 'Auth Error');
        }
        const request: LineSendAnnounceInputScheduleRequest = data;
        const targetId = request.toId ?? process.env.LINE_GROUP_ID;
        if (!targetId) {
            logger.error('必要なパラメータが足りません', request);
            throw new functions.https.HttpsError(
                'invalid-argument',
                '必要なパラメータが足りません',
                {
                    key: 'data',
                    value: request,
                },
            );
        }

        const limitDays = await getScheduleAnswerLimitDays();

        await lineSendAnnounceInputScheduleCore(targetId, limitDays);
        return {
            result: 'OK',
        };
    });

/**
 * 定期的に出欠回答期限内のスケジュールについてグループLINEで通知するジョブ
 *
 * 【toGroup】
 */
export const lineSendAnnounceInputScheduleOnSchedule = functions
    .region('asia-northeast1')
    // TODO: Corntab外から変更できるようにする
    .pubsub.schedule('0 8 * * 0')
    .timeZone('Asia/Tokyo')
    .onRun(async (context) => {
        const targetId = process.env.LINE_GROUP_ID;
        if (!targetId) {
            logger.error('必要なパラメータが足りません', targetId);
            return;
        }

        const limitDays = await getScheduleAnswerLimitDays();

        await lineSendAnnounceInputScheduleCore(targetId, limitDays);
        return {
            result: 'OK',
        };
    });

const getScheduleAnswerLimitDays = async (): Promise<number> => {
    const defaultValue = 20;

    const settingSnapshot = (await firestoreAdmin
        .collection('settings')
        .doc('SCHEDULE_ANSWER_LIMIT_DAYS')
        .get()) as DocumentSnapshot<settingValue>;

    if (!settingSnapshot.exists) {
        return defaultValue;
    }

    const days = settingSnapshot.data()?.value;
    if (!days) {
        return defaultValue;
    }

    if (typeof days !== 'number') {
        return defaultValue;
    }

    return days;
};

const lineSendAnnounceInputScheduleCore = async (
    targetId: string,
    scheduleAnswerLimitDays: number,
) => {
    const settingSnapshot = (await firestoreAdmin
        .collection('settings')
        .doc('LINE_SEND_ANNOUNCE_BACH')
        .get()) as DocumentSnapshot<settingValue>;

    if (!settingSnapshot.exists || !settingSnapshot.data()?.value) {
        logger.warn(`LINE_SEND_ANNOUNCE_BACH の設定によりジョブをパスします。`);
        return;
    }

    const now = new Date();

    const answerLimitStart = new Date(now);
    const answerLimitEnd = new Date(now.setDate(now.getDate() + scheduleAnswerLimitDays));

    const schedulesCollection = firestoreAdmin.collection(
        'schedules',
    ) as CollectionReference<ScheduleDoc>;
    const schedulesSnapshots = await schedulesCollection
        .orderBy('startTimestamp')
        .startAt(answerLimitStart)
        .endAt(answerLimitEnd)
        .get();
    const scheduleDocs = schedulesSnapshots.docs.filter((doc) => !doc.data().isDeleted);

    if (scheduleDocs.length === 0) {
        logger.info(`通知対象のスケジュールが存在しないので終了します`);
        return;
    }

    logger.info(`LINEで出欠回答期限内のスケジュールを通知します`, scheduleDocs);

    const templateColumns: TemplateColumn[] = scheduleDocs.map((scheduleDoc) => {
        const schedule = scheduleDoc.data();
        const startTsDayjs = dayjs(getSaftyDate(schedule.startTimestamp)).tz(STATIC_TIMEZONE);
        const endTsDayjs = dayjs(getSaftyDate(schedule.endTimestamp)).tz(STATIC_TIMEZONE);

        return {
            title: truncateString(`[${startTsDayjs.format('M/D(dd)')}]${schedule?.title}`, 40),
            text: truncateString(
                `${schedule.placeName}[${startTsDayjs.format('M/D(dd)H:mm')}-${endTsDayjs.format(
                    'H:mm',
                )}]`,
                60,
            ),
            defaultAction: {
                type: 'uri',
                label: '詳細を見る',
                uri: `${siteBaseUrl}/member/schedule/${scheduleDoc.id}`,
            },
            actions: [
                {
                    type: 'uri',
                    label: '回答する',
                    uri: `${siteBaseUrl}/member/schedule/${scheduleDoc.id}`,
                },
            ],
        };
    });

    const schedulesMessage: TemplateMessage = {
        type: 'template',
        altText: `回答期限が迫っている予定があります。回答してください〜`,
        template: {
            type: 'carousel',
            columns: templateColumns,
        },
    };

    const announce: TextMessage = {
        type: 'text',
        text: `回答期限が迫っている予定があります。回答してください〜`,
    };

    const message = await noticeLineClient.pushMessage({
        to: targetId,
        messages: [announce, schedulesMessage],
    });

    logger.info(`通知用LINEで出欠回答期限内のスケジュールを通知しました。`, message);
};

type LineSendRemindInputScheduleRequest = {
    toIds: string[];
    scheduleId: string;
    additionalMessage?: string;
};

/**
 * 任意のユーザー達ににスケジュールの回答を促すメッセージを送信するAPI
 *
 * 【toMember】
 */
export const lineSendRemindInputSchedule = functions
    .region('asia-northeast1')
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('permission-denied', 'Auth Error');
        }
        const request: LineSendRemindInputScheduleRequest = data;

        if (!request.toIds || !request.scheduleId || request.toIds.length === 0) {
            logger.error('必要なパラメータが足りません', request);
            throw new functions.https.HttpsError(
                'invalid-argument',
                '必要なパラメータが足りません',
                {
                    key: 'data',
                    value: request,
                },
            );
        }

        if (request.toIds.length === 0) {
            logger.warn('指定された送信先ユーザーが0名なのでなにもしません。', request);
            return {
                result: 'NO_TARGET',
            };
        }

        const scheduleSnapshot = (await firestoreAdmin
            .collection('schedules')
            .doc(request.scheduleId)
            .get()) as DocumentSnapshot<ScheduleDoc>;

        const schedule = scheduleSnapshot.data();

        if (!scheduleSnapshot.exists || !schedule) {
            logger.error(`指定されたスケジュール${request.scheduleId}は存在しません`);
            throw new functions.https.HttpsError(
                'invalid-argument',
                `指定されたスケジュール${request.scheduleId}は存在しません`,
                {
                    key: 'scheduleId',
                    value: request.scheduleId,
                },
            );
        }

        logger.info('催促通知を実行します', schedule, request);

        const startTsDayjs = dayjs(getSaftyDate(schedule.startTimestamp)).tz(STATIC_TIMEZONE);
        const endTsDayjs = dayjs(getSaftyDate(schedule.endTimestamp)).tz(STATIC_TIMEZONE);

        const scheduleMessage: TemplateMessage = {
            type: 'template',
            altText: `出欠を回答してください（[${startTsDayjs.format(
                'M/D(dd)',
            )}]${schedule?.title}）`,
            template: {
                type: 'buttons',
                title: truncateString(`「${schedule.title}」に出欠を回答してください`, 40),
                text: truncateString(
                    `[${startTsDayjs.format('M/D(dd)H:mm')}-${endTsDayjs.format('H:mm')}] @${
                        schedule.placeName
                    }`,
                    60,
                ),
                actions: [
                    {
                        type: 'uri',
                        label: '詳細を見る',
                        uri: `${siteBaseUrl}/member/schedule/${request.scheduleId}`,
                    },
                ],
            },
        };

        const messages: Message[] = [scheduleMessage];

        if (request.additionalMessage) {
            const additionalMessage: TextMessage = {
                type: 'text',
                text: request.additionalMessage,
            };
            messages.push(additionalMessage);
        }

        const message = await client.multicast({
            to: request.toIds.filter((id) => id),
            messages: messages,
        });

        logger.info(`LINEで催促通知しました`, message);
        return {
            result: 'OK',
        };
    });

function truncateString(str: string, length = 40): string {
    if (str.length <= length) {
        return str;
    }
    return str.substring(0, length);
}

/**
 * Timestamp から Date を取得する
 *
 * エミュレータだと何故かTimestamp型の情報が不足し、toDate()が使えないので再生成しtoDateを返す
 * @param unsafetyTimestamp
 * @returns
 */
function getSaftyDate(unsafetyTimestamp: Timestamp) {
    let safetyDate;
    try {
        safetyDate = unsafetyTimestamp.toDate();
    } catch (error) {
        if (error instanceof TypeError) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dengerTimestamp: any = unsafetyTimestamp;
            const safetyTimestamp = new Timestamp(
                dengerTimestamp._seconds,
                dengerTimestamp._nanoseconds,
            );
            safetyDate = safetyTimestamp.toDate();
        } else {
            throw error;
        }
    }
    return safetyDate;
}

type buildReplicaScheduleFromPrdToDevRequest = {
    token: string;
};

/**
 * 本番環境のスケジュールコレクションを開発環境のスケジュールコレクションにレプリカするAPI
 */
export const buildReplicaScheduleFromPrdToDev = functions
    .region('asia-northeast1')
    .https.onCall(async (data, context) => {
        const request = data as buildReplicaScheduleFromPrdToDevRequest;
        if (request.token !== process.env.TOKEN) {
            throw new functions.https.HttpsError('permission-denied', 'Auth Token Error');
        }

        const targetCollectionName = 'schedules';
        logger.info('buildReplicaFromPrdToDev start');
        const sourceStore = getAnotherFirestore();
        const targetStore = firestoreAdmin;

        logger.info(`[${targetCollectionName}] データのレプリカを開始します`, {
            sourceStore: sourceStore,
            targetStore: targetStore,
        });

        // targetのコレクションを全件削除しておく
        const targetCollectionSnapshots = (await targetStore
            .collection(targetCollectionName)
            .get()) as QuerySnapshot<ScheduleDoc>;
        const deleteBatch = targetStore.batch();
        targetCollectionSnapshots.forEach((doc) => {
            deleteBatch.delete(doc.ref);
        });
        await deleteBatch.commit();

        logger.info(
            `[${targetCollectionName}] データを削除しました。${targetCollectionSnapshots.size}件`,
        );

        const fromCollectionSnapshots = (await sourceStore
            .collection(targetCollectionName)
            .get()) as QuerySnapshot<ScheduleDoc>;

        const writeBatch = targetStore.batch();
        fromCollectionSnapshots.forEach((doc) => {
            const replicaData = {
                ...doc.data(),
                okMembers: [],
                ngMembers: [],
                holdMembers: [],
                createdBy: 'replica',
                updatedBy: 'replica',
            };
            logger.log(`[${targetCollectionName}] データをレプリカします`, doc.id, replicaData);
            const targetDoc = targetStore.collection(targetCollectionName).doc(doc.id);
            writeBatch.set(targetDoc, replicaData);
        });

        await writeBatch.commit();
        logger.info(
            `[${targetCollectionName}] データのレプリカが完了しました。${fromCollectionSnapshots.size}件`,
            {
                sourceStore: sourceStore,
                targetStore: targetStore,
            },
        );

        logger.info('buildReplicaFromPrdToDev end');

        return {
            result: {
                message: `[${targetCollectionName}] データのレプリカが完了しました。${fromCollectionSnapshots.size}件`,
            },
        };
    });
