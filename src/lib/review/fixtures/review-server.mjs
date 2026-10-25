import { createServer } from 'node:http';

createServer((request,response)=>{
	if (request.url === '/api/anyreview-health') {
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify({ service: 'anyreview' }));
		return;
	}
	response.setHeader('x-anyreview-server','1');
	response.end('AnyReview test server');
}).listen(Number(process.env.PORT),process.env.HOST);
