import { exec } from 'child_process';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async (): Promise<Response> => {
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			// Start the calculation process
			const process = exec('npm run calculate:legislation');

			let currentBill = 0;
			let totalBills = 0;

			// Send progress updates
			const sendProgress = (progress: number, message: string) => {
				const data = JSON.stringify({ progress, message });
				controller.enqueue(encoder.encode(`data: ${data}\n\n`));
			};

			// Parse stdout for progress
			if (process.stdout) {
				process.stdout.on('data', (data) => {
					const output = data.toString();
					console.log(output);

					// Parse progress from output
					const totalMatch = output.match(/Processing (\d+) bills/);
					if (totalMatch) {
						totalBills = parseInt(totalMatch[1], 10);
						sendProgress(5, `${totalBills}件の議案を処理中...`);
					}

					const billMatch = output.match(/Processing Bill ID: (\d+)/);
					if (billMatch && totalBills > 0) {
						currentBill++;
						const progress = Math.min(5 + (currentBill / totalBills) * 85, 90);
						sendProgress(progress, `議案を処理中... (${currentBill}/${totalBills})`);
					}

					if (output.includes('JSON data saved')) {
						sendProgress(95, 'データを保存中...');
					}

					if (output.includes('completed successfully')) {
						sendProgress(100, '計算が完了しました！');
					}
				});
			}

			// Handle stderr
			if (process.stderr) {
				process.stderr.on('data', (data) => {
					console.error('stderr:', data.toString());
				});
			}

			// Handle completion
			process.on('close', (code) => {
				if (code === 0) {
					sendProgress(100, '計算が完了しました！ページを再読み込みしてください。');
					controller.enqueue(encoder.encode('data: {"done": true, "success": true}\n\n'));
				} else {
					controller.enqueue(
						encoder.encode(
							`data: {"done": true, "success": false, "error": "Process exited with code ${code}"}\n\n`
						)
					);
				}
				controller.close();
			});

			// Handle errors
			process.on('error', (error) => {
				console.error('Process error:', error);
				controller.enqueue(
					encoder.encode(`data: {"done": true, "success": false, "error": "${error.message}"}\n\n`)
				);
				controller.close();
			});
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
