import { createServer } from 'node:http';

createServer((_request,response)=>{
	response.setHeader('x-reviewloop-server','1');
	response.end('ReviewLoop test server');
}).listen(Number(process.env.PORT),process.env.HOST);
