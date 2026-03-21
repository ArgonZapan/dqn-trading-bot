/**
 * API Routes for dashboard
 */
module.exports = {
    '/api/status': (req, res) => {
        res.json({ status: 'running', time: new Date().toISOString() });
    },
    '/api/prices': (req, res) => {
        res.json(prices);
    }
};
</parameter>
