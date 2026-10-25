import { createServer } from 'node:http';

createServer((request,response)=>{
	if (request.url === '/api/reviewloop-health') {
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify({ service: 'reviewloop' }));
		return;
	}
	response.setHeader('x-reviewloop-server','1');
	response.end('ReviewLoop test server');
}).listen(Number(process.env.PORT),process.env.HOST);
