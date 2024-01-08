import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import { google, sheets_v4 } from 'googleapis';
import { paymentColumn } from './paymentColumn';

const SPREADSHEET_ID = process.env.ACCOUNTING_SPREADSHEET_ID || '';
const TARGET_SHEET = '明細';
const TARGET_RANGE_END_CELL = 'S211';

type PaymentInput = {
    /** 精算済みかどうか */
    paid: boolean;
    /** 日付 YYYY/MM/DD */
    paidDate: string;
    /** タイプ（試合|練習|その他） */
    type: string;
    /** 内容 */
    description: string;
    /** 参加費 */
    participationFeeIncome: number;
    /** 相手チームから */
    fromVsTeamIncome: number;
    /** その他収入 */
    otherIncome: number;
    /** 場代 */
    groundFeeExpenses: number;
    /** 審判代 */
    umpirFeeExpenses: number;
    /** その他支出 */
    otherExpenses: number;
    /** 備考 */
    remarks: string;
    /** 建て替えた人 */
    paidMenberName: string;
};

export const addPayment = functions
    .region('asia-northeast1')
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('permission-denied', 'Auth Error');
        }

        const paymentInput: PaymentInput = data;
        if (!paymentInput.paidDate || !paymentInput.type || !paymentInput.description) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                '必須項目が入力されていません。',
            );
        }

        const sheets = await getSheet();
        const gssResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: buildRange(TARGET_SHEET, 'A1', TARGET_RANGE_END_CELL),
        });

        const rows = gssResponse.data.values;
        if (!rows || rows.length === 0) {
            logger.log('データが存在しません。');
            return;
        }

        // 精算日が空の行を探す
        let emptyRowIndex = rows.findIndex((row) => !row[paymentColumn.PAID_DATE]);
        if (emptyRowIndex === -1) {
            emptyRowIndex = rows.length;
        }

        logger.log('空の行のインデックス', emptyRowIndex);

        const updateData = buildRowValue(paymentInput);
        logger.log('更新するデータ', updateData);

        // データを更新
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: buildRange(TARGET_SHEET, `A${emptyRowIndex + 1}`, TARGET_RANGE_END_CELL),
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [updateData],
            },
        });
        logger.log(`A${emptyRowIndex + 1} 行目にデータを更新しました。`, updateData);
    });

const getSheet = async (): Promise<sheets_v4.Sheets> => {
    const auth = await google.auth.getClient({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    if (!auth) {
        logger.log('Spreadsheetにアクセスする権限がありません');
        throw new Error('Spreadsheetにアクセスする権限がありません');
    }
    return google.sheets({ version: 'v4', auth });
};

const buildRange = (sheetName: string, startCell: string, endCell: string): string => {
    return `${sheetName}!${startCell}:${endCell}`;
};

const buildRowValue = (paymentInput: PaymentInput): (string | number | boolean)[] => {
    const rowValue = new Array(paymentColumn.LAST_COLUMN + 1).fill(null);
    rowValue[paymentColumn.PAID] = paymentInput.paid;
    rowValue[paymentColumn.PAID_DATE] = paymentInput.paidDate;
    rowValue[paymentColumn.TYPE] = paymentInput.type;
    rowValue[paymentColumn.DESCRIPTION] = paymentInput.description;
    rowValue[paymentColumn.PARTICIPATION_FEE_INCOM] = paymentInput.participationFeeIncome;
    rowValue[paymentColumn.FROM_VS_TEAM_INCOM] = paymentInput.fromVsTeamIncome;
    rowValue[paymentColumn.OTHER_INCOME] = paymentInput.otherIncome;
    rowValue[paymentColumn.GROUND_FEE_XPENSES] = paymentInput.groundFeeExpenses;
    rowValue[paymentColumn.UMPIR_FEE_XPENSES] = paymentInput.umpirFeeExpenses;
    rowValue[paymentColumn.OTHER_EXPENSES] = paymentInput.otherExpenses;
    rowValue[paymentColumn.RRMAEKS] = paymentInput.remarks;
    rowValue[paymentColumn.PAID_MENBER] = paymentInput.paidMenberName;
    return rowValue;
};
