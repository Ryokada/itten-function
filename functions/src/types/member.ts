type Member = {
    /**
     * メンバーのアカウントID
     */
    id: string;

    /**
     * メンバーのメールアドレス
     */
    email: string;

    /**
     * 名前
     */
    name: string;

    /**
     * 背番号
     *
     * 001などがあるので文字列
     */
    number: string;

    /**
     * LINEID
     */
    lineId?: string;

    /**
     * LINE名
     */
    lineName?: string;

    /**
     * アイコン画像のURL
     */
    imageUrl?: string;

    /**
     * 希望ポジション
     *
     * ポジション番号の配列
     */
    desiredPositions: Array<string>;

    /**
     * ポジションについてコメント
     */
    positionComment?: string;

    /**
     * メンバーのロール
     */
    role: 'admin' | 'member';
};

export default Member;
